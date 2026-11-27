using System.Globalization;
using System.IO.Compression;
using System.Text;

namespace DaydayPDF.PrintReceiver;

internal sealed class VectorPdf(Stream output)
{
    private readonly List<long> offsets = [0, 0, 0];
    private readonly List<int> pages = [];
    internal static string Num(double value) => value.ToString("0.#########", CultureInfo.InvariantCulture);
    internal static void Write(Stream target, string text) => target.Write(Encoding.ASCII.GetBytes(text));

    internal void Start() => Write(output, "%PDF-1.7\n");
    private int Object(int id = 0)
    {
        if (id == 0) { id = offsets.Count; offsets.Add(0); }
        offsets[id] = output.Position;
        Write(output, $"{id} 0 obj\n");
        return id;
    }

    private int StreamObject(string attrs, MemoryStream compressed)
    {
        int id = Object();
        Write(output, $"<< {attrs} /Filter /FlateDecode /Length {compressed.Length} >>\nstream\n");
        compressed.WriteTo(output);
        Write(output, "\nendstream\nendobj\n");
        return id;
    }

    internal int Image(int width, int height, int bits, string color, byte[] data, int mask = 0)
    {
        using var compressed = new MemoryStream();
        using (var z = new ZLibStream(compressed, CompressionLevel.Fastest, true)) z.Write(data);
        string attrs = $"/Type /XObject /Subtype /Image /Width {width} /Height {height} /BitsPerComponent {bits} /ColorSpace /{color}";
        return StreamObject(mask == 0 ? attrs : attrs + $" /SMask {mask} 0 R", compressed);
    }

    internal void Page(MemoryStream content, List<int> images, Paper paper)
    {
        int stream = StreamObject("", content);
        pages.Add(Object());
        Write(output, $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {Num(paper.Width)} {Num(paper.Height)}] /Resources << /XObject << ");
        foreach (int image in images) Write(output, $"/I{image} {image} 0 R ");
        Write(output, $">> >> /Contents {stream} 0 R >>\nendobj\n");
    }

    internal void Finish()
    {
        Object(2);
        Write(output, $"<< /Type /Pages /Count {pages.Count} /Kids [{string.Join(" ", pages.Select(id => $"{id} 0 R"))}] >>\nendobj\n");
        Object(1);
        Write(output, "<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        long xref = output.Position;
        Write(output, $"xref\n0 {offsets.Count}\n0000000000 65535 f \n");
        foreach (long offset in offsets.Skip(1)) Write(output, offset.ToString("D10", CultureInfo.InvariantCulture) + " 00000 n \n");
        Write(output, $"trailer\n<< /Size {offsets.Count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
    }
}

internal sealed record Paper(int PixelsX, int PixelsY, double Width, double Height, string Matrix)
{
    internal static Paper From(byte[] mode, int[] caps)
    {
        if (mode.Length < 166 || caps.Length != 8) throw new InvalidDataException("인쇄 용지 정보가 없습니다.");
        int w = caps[0], h = caps[1], dx = caps[2], dy = caps[3], px = caps[4], py = caps[5];
        if (w <= 0 || h <= 0 || px < w || py < h || px >= 100000 || py >= 100000 ||
            dx is < 72 or > 9600 || dy is < 72 or > 9600 || BitConverter.ToInt16(mode, 84) != 100)
            throw new InvalidDataException("지원하지 않는 인쇄 배율 또는 용지입니다.");
        double sx = 72d / dx, sy = 72d / dy;
        var (width, height) = PhysicalSize(mode, caps);
        double deviceW = Math.Abs(px * sx - width) < 1 ? width : px * sx;
        double deviceH = Math.Abs(py * sy - height) < 1 ? height : py * sy;
        double factor = Math.Max(deviceW / (w * sx), deviceH / (h * sy));
        double left = (deviceW - w * sx * factor) / 2, top = (deviceH - h * sy * factor) / 2;
        string matrix = $"q {VectorPdf.Num(sx * factor)} 0 0 {VectorPdf.Num(-sy * factor)} {VectorPdf.Num(left)} {VectorPdf.Num(height - top)} cm\n";
        return new(w, h, width, height, matrix);
    }

    internal static (double Width, double Height) PhysicalSize(byte[] mode, int[] caps)
    {
        double width = caps[4] * 72d / caps[2], height = caps[5] * 72d / caps[3];
        int flags = BitConverter.ToInt32(mode, 72), id = BitConverter.ToInt16(mode, 78);
        (double mmW, double mmH) = (flags & 2) == 0 ? (0, 0) : id switch
        {
            1 => (215.9, 279.4),
            3 => (279.4, 431.8),
            5 => (215.9, 355.6),
            8 => (297, 420),
            9 => (210, 297),
            11 => (148, 210),
            12 => (257, 364),
            13 => (182, 257),
            _ => (0, 0)
        };
        if (mmW == 0 && (flags & 12) == 12)
            (mmW, mmH) = (BitConverter.ToInt16(mode, 82) / 10d, BitConverter.ToInt16(mode, 80) / 10d);
        if (BitConverter.ToInt16(mode, 76) == 2) (mmW, mmH) = (mmH, mmW);
        bool custom = ((flags & 2) == 0 || id == 0 || id >= 256) && (flags & 12) == 12;
        if (mmW > 0 && mmH > 0 && (custom || (Math.Abs(width - mmW * 72 / 25.4) < 1 && Math.Abs(height - mmH * 72 / 25.4) < 1)))
            (width, height) = (mmW * 72 / 25.4, mmH * 72 / 25.4);
        return (width, height);
    }
}
