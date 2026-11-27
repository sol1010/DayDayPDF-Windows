using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DaydayPDF.PrintReceiver;

internal sealed class EmfPage(VectorPdf pdf, Paper paper)
{
    private readonly List<int> images = [];
    private readonly Dictionary<(int, int), Tile> tiles = [];
    private readonly Dictionary<string, string> styles = [];
    private string? style;
    private Stream code = Stream.Null;
    private (int X, int Y)? previous;
    private (int L, int T, int R, int B)? outline, clip;
    private readonly MemoryStream pending = new();
    private static readonly Regex Colors = new(@"([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s+SC\b", RegexOptions.NonBacktracking);
    private static readonly Regex Words = new("[A-Za-z]+", RegexOptions.NonBacktracking);
    private static readonly Regex Style = new(@"^(?:[012] setlinecap\r\n[012] setlinejoin\r\n[-+.\d]+ setmiterlimit\r\n[-+.\d]+ setlinewidth\r\n\[\] 0 setdash\r\n)?[-+.\d]+ [-+.\d]+ [-+.\d]+ SC\r\n\z", RegexOptions.NonBacktracking);
    private static readonly Regex BadPath = new(@"[^0-9.+\-\smlcCP]", RegexOptions.NonBacktracking);
    private static readonly Regex BadVector = new(@"[^0-9a-zA-Z\[\]\s.+-]", RegexOptions.NonBacktracking);
    private static readonly byte[] EndPath = Convert.FromHexString("000001010500000000000000000001000000000000000000000000000000");
    private static readonly byte[] VectorPrologue = Convert.FromHexString("4499F443395AB2A195F5AB46DACC5EFE14951C2D1775656CC404363B9161A1D8");
    private static readonly Dictionary<int, byte[][]> States = new()
    {
        [37] = [Convert.FromHexString("0e000080"), Convert.FromHexString("00000080"), Convert.FromHexString("07000080")],
        [13] = [new byte[8]],
        [98] = [BitConverter.GetBytes(1)],
        [100] = [Convert.FromHexString("14000080")],
        [12] = [new byte[8]],
        [10] = [new byte[8]],
        [20] = [BitConverter.GetBytes(13)],
        [75] = [Convert.FromHexString("0000000005000000")],
        [34] = [BitConverter.GetBytes(-1)],
        [36] = [Convert.FromHexString("0000803f00000000000000000000803f000000000000000001000000")]
    };

    private sealed class Tile
    {
        public readonly byte[] Rgb = new byte[128 * 128 * 3], Alpha = new byte[128 * 128];
        public int Left = 128, Top = 128, Right, Bottom;
    }

    internal static void Require(bool ok)
    {
        if (!ok) throw new InvalidDataException("고속 프린터에서 지원하지 않는 인쇄 기록입니다.");
    }
    private static int I(ReadOnlySpan<byte> bytes, int offset) => BitConverter.ToInt32(bytes[offset..]);
    private static int H(ReadOnlySpan<byte> bytes, int offset) => BitConverter.ToInt16(bytes[offset..]);
    private void Write(string s) => VectorPdf.Write(code, s);
    private void CloseStyle() { if (style != null) { Write("Q\n"); style = null; } }
    private static string Translate(string s)
    {
        Require(!BadVector.IsMatch(s) && !s.Contains("rg") && !s.Contains("RG"));
        string colors = Colors.Replace(s, "$1 $2 $3 rg $1 $2 $3 RG");
        return Words.Replace(colors, m => m.Value switch
        {
            "NP" => "n",
            "CP" => "h",
            "m" or "l" or "c" or "rg" or "RG" => m.Value,
            "eofill" => "f*",
            "fill" => "f",
            "stroke" => "S",
            "eoclip" => "W* n",
            "setdash" => "d",
            "setlinecap" => "J",
            "setlinejoin" => "j",
            "setmiterlimit" => "M",
            "setlinewidth" => "w",
            _ => throw new InvalidDataException("지원하지 않는 벡터 연산입니다.")
        });
    }

    internal static string DrawingBody(ReadOnlySpan<byte> data)
    {
        int start = data.IndexOf("GpPBeg1\r\n"u8);
        Require(start >= 0 && data.EndsWith("GSE\r\n"u8));
        if (start > 0) Require(SHA256.HashData(data[..start]).AsSpan().SequenceEqual(VectorPrologue));
        return Encoding.ASCII.GetString(data[(start + 9)..^5]);
    }

    private void Vector(ReadOnlySpan<byte> data)
    {
        string body = DrawingBody(data);
        int begin = body.IndexOf("NP ", StringComparison.Ordinal), last = body.LastIndexOf(' ');
        if (begin >= 0 && last >= begin + 3 && body.EndsWith("\r\n", StringComparison.Ordinal))
        {
            string? paint = body[(last + 1)..^2] switch { "stroke" => "S", "fill" => "f", "eofill" => "f*", _ => null };
            string path = body[(begin + 3)..last], prefix = body[..begin];
            if (paint != null && !BadPath.IsMatch(path))
            {
                if (style != prefix && Style.IsMatch(prefix))
                {
                    if (!styles.TryGetValue(prefix, out var mapped)) { mapped = Translate(prefix); if (styles.Count < 512) styles[prefix] = mapped; }
                    CloseStyle(); Write("q\n"); Write(mapped); style = prefix;
                }
                if (style == prefix) { Write(path.Replace("CP", "h", StringComparison.Ordinal)); Write(" " + paint + "\n"); return; }
            }
        }
        CloseStyle(); Write("q\n"); Write(Translate(body)); Write("Q\n");
    }

    private void Place(int id, int x, int y, int w, int h)
    {
        Write($"q {w} 0 0 {-h} {x} {y + h} cm /I{id} Do Q\n");
        images.Add(id);
    }
    private void Row(int x, int y, ReadOnlySpan<byte> bgr)
    {
        Require(x >= 0 && y >= 0);
        while (!bgr.IsEmpty)
        {
            int tx = x / 128, ty = y / 128, lx = x % 128, ly = y % 128, n = Math.Min(bgr.Length / 3, 128 - lx);
            if (!tiles.TryGetValue((tx, ty), out var t))
            {
                Require(tiles.Count < 2048);
                tiles[(tx, ty)] = t = new Tile();
            }
            int at = ly * 128 + lx;
            t.Alpha.AsSpan(at, n).Fill(255);
            for (int k = 0; k < n; k++) { int o = 3 * (at + k), i = k * 3; t.Rgb[o] = bgr[i + 2]; t.Rgb[o + 1] = bgr[i + 1]; t.Rgb[o + 2] = bgr[i]; }
            t.Left = Math.Min(t.Left, lx); t.Top = Math.Min(t.Top, ly); t.Right = Math.Max(t.Right, lx + n); t.Bottom = Math.Max(t.Bottom, ly + 1);
            x += n; bgr = bgr[(n * 3)..];
        }
    }
    private void FlushTiles()
    {
        foreach (var (key, t) in tiles)
        {
            int w = t.Right - t.Left, h = t.Bottom - t.Top;
            byte[] rgb = new byte[w * h * 3], alpha = new byte[w * h];
            for (int y = 0; y < h; y++)
            {
                int a = (t.Top + y) * 128 + t.Left;
                t.Alpha.AsSpan(a, w).CopyTo(alpha.AsSpan(y * w));
                t.Rgb.AsSpan(a * 3, w * 3).CopyTo(rgb.AsSpan(y * w * 3));
            }
            int mask = Array.IndexOf(alpha, (byte)0) >= 0 ? pdf.Image(w, h, 8, "DeviceGray", alpha) : 0;
            Place(pdf.Image(w, h, 8, "DeviceRGB", rgb, mask), key.Item1 * 128 + t.Left, key.Item2 * 128 + t.Top, w, h);
        }
        tiles.Clear();
    }

    private void Bitmap(ReadOnlySpan<byte> r)
    {
        CloseStyle(); Require(pending.Length == 0 && clip.HasValue && r.Length >= 80);
        var (l, t, right, b) = clip!.Value;
        int x = I(r, 24), y = I(r, 28), sw = I(r, 40), sh = I(r, 44), off = I(r, 48), cb = I(r, 52), ob = I(r, 56), nb = I(r, 60), dw = I(r, 72), dh = I(r, 76);
        Require(off >= 80 && cb >= 40 && off <= r.Length - cb && ob >= 0 && nb >= 0 && ob <= r.Length - nb &&
                I(r, 32) == 0 && I(r, 36) == 0 && I(r, 64) == 0 && I(r, 68) == 0xCC0020 && H(r, off + 12) == 1 && I(r, off + 16) == 0);
        int bw = I(r, off + 4), bh = I(r, off + 8), bits = H(r, off + 14);
        if (bits == 24)
        {
            Require(sw == dw && sw == bw && sh == 1 && dh == 1 && bh == 1 && sw > 0 && sw < 100000 && nb >= sw * 3);
            int a = Math.Max(l, x), z = Math.Min(right, checked(x + sw));
            if (y >= t && y < b && a < z) Row(a, y, r.Slice(checked(ob + (a - x) * 3), (z - a) * 3));
        }
        else
        {
            Require(bits == 1 && bw >= sw && sw > 0 && bh == sh && sh > 0 && dw > 0 && dh > 0 &&
                    cb >= 48 && r.Slice(off + 40, 8).SequenceEqual(new byte[] { 0, 0, 0, 0, 255, 255, 255, 0 }));
            FlushTiles();
            int stride = checked((bw + 31) / 32 * 4), row = checked((sw + 7) / 8);
            Require((long)stride * bh <= nb);
            byte[] data = new byte[checked(row * sh)];
            for (int yy = 0; yy < sh; yy++) r.Slice(ob + (sh - 1 - yy) * stride, row).CopyTo(data.AsSpan(yy * row));
            Write($"q {l} {t} {right - l} {b - t} re W n\n");
            Place(pdf.Image(sw, sh, 1, "DeviceGray", data), x, y, dw, dh); Write("Q\n");
        }
    }

    private void Escape(ReadOnlySpan<byte> r)
    {
        int kind = I(r, 8), n = I(r, 12); Require(n >= 0 && n <= r.Length - 16);
        switch (kind)
        {
            case 19:
                Require(n >= 2 && BitConverter.ToUInt16(r[16..]) == n - 2);
                if (pending.Length == 0) FlushTiles();
                Require(pending.Length + n - 2 <= 1048576);
                pending.Write(r.Slice(18, n - 2));
                var data = pending.GetBuffer().AsSpan(0, (int)pending.Length);
                if (data.EndsWith("GSE\r\n"u8)) { Vector(data); pending.SetLength(0); }
                break;
            case 4097:
                Require(n >= 4);
                int f = I(r, 16);
                if (f == 65538) { Require(outline != null); clip = outline; }
                else { Require(f is 0 or 1); clip = null; outline = null; }
                break;
            case 4096: Require(n == 0); break;
            case 4098: Require(r.Slice(16, n).SequenceEqual(EndPath)); break;
            default: Require(false); break;
        }
    }
    private void Outline(ReadOnlySpan<byte> r, int type)
    {
        int stride = type == 6 ? 8 : 4; Require(previous.HasValue && r.Length == 28 + 4 * stride && I(r, 24) == 4);
        var p = new (int X, int Y)[5]; p[0] = previous!.Value;
        for (int j = 0; j < 4; j++) { int i = 28 + j * stride; p[j + 1] = stride == 8 ? (I(r, i), I(r, i + 4)) : (H(r, i), H(r, i + 2)); }
        int l = p.Min(a => a.X), t = p.Min(a => a.Y), z = p.Max(a => a.X), b = p.Max(a => a.Y);
        Require(p.Contains((l, t)) && p.Contains((l, b)) && p.Contains((z, t)) && p.Contains((z, b)));
        for (int j = 0; j < 5; j++) Require(p[j].X == p[(j + 1) % 5].X || p[j].Y == p[(j + 1) % 5].Y);
        outline = (l, t, z, b);
    }
    internal void Render(Stream source, int length, CancellationToken stop)
    {
        using var content = new MemoryStream();
        using (var zip = new ZLibStream(content, CompressionLevel.Fastest, true))
        using (var buffered = new BufferedStream(zip, 65536))
        {
            code = buffered; Write(paper.Matrix);
            int left = length, index = 0; bool ended = false;
            byte[] record = new byte[4096];
            while (left > 0)
            {
                if ((index & 127) == 0) { stop.ThrowIfCancellationRequested(); ReceiverProgress.Advanced(); }
                Require(left >= 8 && !ended);
                source.ReadExactly(record, 0, 8);
                int type = I(record, 0), n = I(record, 4); Require(n >= 8 && n <= left && n <= 64 * 1024 * 1024);
                if (n > record.Length) Array.Resize(ref record, n);
                source.ReadExactly(record, 8, n - 8); var r = record.AsSpan(0, n);
                if (index++ == 0) Require(type == 1 && n >= 88 && r.Slice(40, 4).SequenceEqual(" EMF"u8) && I(r, 48) == length && I(r, 72) == paper.PixelsX && I(r, 76) == paper.PixelsY);
                switch (type)
                {
                    case 14: ended = true; break;
                    case 81: Bitmap(r); break;
                    case 106: Escape(r); break;
                    case 27: previous = (I(r, 8), I(r, 12)); break;
                    case 89: case 6: Outline(r, type); break;
                    case 1: case 33: case 59: case 60: case 61: case 64: break;
                    default:
                        Require(States.TryGetValue(type, out var options));
                        bool match = false; foreach (var expected in options!) if (r[8..].SequenceEqual(expected)) { match = true; break; }
                        Require(match); break;
                }
                left -= n;
            }
            Require(ended && pending.Length == 0 && clip == null); CloseStyle(); FlushTiles(); Write("Q\n");
        }
        pdf.Page(content, images, paper);
    }
}
