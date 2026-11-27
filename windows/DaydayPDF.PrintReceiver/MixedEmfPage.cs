using System.Buffers.Binary;
using System.Globalization;

namespace DaydayPDF.PrintReceiver;

internal sealed class MixedEmfPage
{
    private const int Fraction = 16;
    private const int MaxPage = 256 * 1024 * 1024;
    private readonly MemoryStream output = new();
    private readonly BinaryWriter writer;
    private readonly int handle;
    private readonly int[] bounds;
    private int records;

    private MixedEmfPage(byte[] page, int offset, int preceding)
    {
        handle = BitConverter.ToUInt16(page, 56);
        Check(handle > 0 && handle < ushort.MaxValue);
        bounds = [Math.Min(0, BitConverter.ToInt32(page, 8)), Math.Min(0, BitConverter.ToInt32(page, 12)),
            Math.Max(BitConverter.ToInt32(page, 72), BitConverter.ToInt32(page, 16)),
            Math.Max(BitConverter.ToInt32(page, 76), BitConverter.ToInt32(page, 20))];
        writer = new BinaryWriter(output);
        output.Write(page, 0, offset);
        records = preceding;
    }

    private static void Check(bool valid)
    {
        if (!valid) throw new InvalidDataException("혼합 인쇄 페이지의 벡터 기록이 잘못되었거나 지원되지 않습니다.");
    }

    internal static byte[] Prepare(byte[] page, int length, CancellationToken stop)
    {
        Check(length >= 88 && length <= page.Length && length <= MaxPage && BitConverter.ToInt32(page) == 1 &&
            BitConverter.ToInt32(page, 4) >= 88 && BitConverter.ToInt32(page, 48) == length && page.AsSpan(40, 4).SequenceEqual(" EMF"u8));
        MixedEmfPage? mixed = null;
        using var pending = new MemoryStream();
        int count = 0, last = 0;
        bool pathOpen = false;
        for (int at = 0; at < length; count++)
        {
            stop.ThrowIfCancellationRequested();
            ReceiverProgress.Advanced();
            Check(length - at >= 8);
            last = BitConverter.ToInt32(page, at);
            int size = BitConverter.ToInt32(page, at + 4);
            Check(size >= 8 && (size & 3) == 0 && size <= length - at && (last != 14 || size == length - at));
            var record = page.AsSpan(at, size);
            bool passthrough = last == 106 && size >= 16 && BitConverter.ToInt32(record[8..]) == 19;
            if (passthrough)
            {
                Check(!pathOpen && size >= 18);
                int bytes = BitConverter.ToInt32(record[12..]);
                Check(bytes >= 2 && bytes <= size - 16 && BitConverter.ToUInt16(record[16..]) == bytes - 2 &&
                    pending.Length + bytes - 2 <= 1048576);
                mixed ??= new MixedEmfPage(page, at, count);
                pending.Write(record.Slice(18, bytes - 2));
                var data = pending.GetBuffer().AsSpan(0, (int)pending.Length);
                if (data.EndsWith("GSE\r\n"u8))
                {
                    mixed.Draw(EmfPage.DrawingBody(data), stop);
                    pending.SetLength(0);
                }
            }
            else
            {
                Check(pending.Length == 0);
                if (last is 105 or 106 or 110 &&
                    !(last == 106 && size == 16 && BitConverter.ToInt32(record[8..]) == 20 && BitConverter.ToInt32(record[12..]) == 0))
                    throw new InvalidDataException($"지원하지 않는 프린터 전용 명령입니다 (EMF {last}, 코드 {(size >= 12 ? BitConverter.ToInt32(record[8..]) : -1)}).");
                if (last == 59) pathOpen = true;
                if (last is 62 or 63 or 64 or 67 or 68) pathOpen = false;
                if (mixed != null)
                {
                    Check(mixed.output.Length + size <= MaxPage);
                    mixed.output.Write(record);
                    mixed.records++;
                }
            }
            at += size;
        }
        Check(last == 14 && pending.Length == 0);
        if (mixed == null) return page;
        var result = mixed.output.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(48), result.Length);
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(52), mixed.records);
        BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(56), (ushort)(mixed.handle + 1));
        return result;
    }

    private void Record(int type, params ReadOnlySpan<int> values)
    {
        int size = 8 + values.Length * 4;
        Check(output.Length + size <= MaxPage);
        writer.Write(type); writer.Write(size);
        foreach (int n in values) writer.Write(n);
        records++;
    }

    private static int Unit(double value)
    {
        Check(double.IsFinite(value) && Math.Abs(value) <= 16_000_000);
        return (int)Math.Round(value * Fraction, MidpointRounding.AwayFromZero);
    }

    private void Draw(string body, CancellationToken stop)
    {
        Record(33);
        Record(17, 1);
        Record(10, 0, 0); Record(12, 0, 0);
        int scale = BitConverter.SingleToInt32Bits(1f / Fraction);
        Record(35, scale, 0, 0, scale, 0, 0);
        Record(75, 0, 5);
        var args = new double[6];
        int n = 0, color = 0, cap = 0x200, join = 0x2000, width = Fraction;
        bool path = false, current = false, emptyDash = false;
        foreach (var word in body.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            stop.ThrowIfCancellationRequested();
            if (double.TryParse(word, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out double value))
            {
                Check(n < args.Length && double.IsFinite(value));
                args[n++] = value;
                continue;
            }
            switch (word)
            {
                case "NP":
                    Check(n == 0);
                    if (path) Record(68);
                    Record(59); path = true; current = false;
                    break;
                case "m": case "l":
                    Check(path && n == 2 && (word == "m" || current));
                    Record(word == "m" ? 27 : 54, Unit(args[0]), Unit(args[1]));
                    current = true;
                    break;
                case "c":
                    Check(path && current && n == 6);
                    Record(5, bounds[0], bounds[1], bounds[2], bounds[3], 3,
                        Unit(args[0]), Unit(args[1]), Unit(args[2]), Unit(args[3]), Unit(args[4]), Unit(args[5]));
                    break;
                case "CP": Check(path && current && n == 0); Record(61); break;
                case "SC":
                    Check(n == 3 && args.Take(3).All(x => x is >= 0 and <= 1));
                    color = (int)Math.Round(args[0]*255) | ((int)Math.Round(args[1]*255) << 8) | ((int)Math.Round(args[2]*255) << 16);
                    break;
                case "setlinecap": case "setlinejoin":
                    Check(n == 1 && args[0] is 0 or 1 or 2);
                    if (word == "setlinecap") cap = args[0] switch { 0 => 0x200, 2 => 0x100, _ => 0 };
                    else join = args[0] switch { 0 => 0x2000, 2 => 0x1000, _ => 0 };
                    break;
                case "setmiterlimit":
                    Check(n == 1 && args[0] is >= 1 and <= 100000);
                    Record(58, (int)Math.Round(args[0], MidpointRounding.AwayFromZero)); break;
                case "setlinewidth": Check(n == 1 && args[0] >= 0); width = Unit(args[0]); break;
                case "[]": Check(n == 0 && !emptyDash); emptyDash = true; break;
                case "setdash": Check(emptyDash && n == 1 && args[0] == 0); emptyDash = false; break;
                case "eoclip": case "eofill": case "fill": case "stroke":
                    Check(path && current && n == 0);
                    Record(60);
                    if (word == "stroke")
                    {
                        Record(95, handle, 52, 0, 52, 0, width == 0 ? 0 : 0x10000 | cap | join,
                            width == 0 ? 1 : width, 0, color, 0, 0);
                        Record(37, handle); Record(64, bounds); Record(37, unchecked((int)0x80000007)); Record(40, handle);
                    }
                    else
                    {
                        Record(19, word == "fill" ? 2 : 1);
                        if (word == "eoclip") Record(67, 1);
                        else
                        {
                            Record(39, handle, 0, color, 0); Record(37, handle); Record(62, bounds);
                            Record(37, unchecked((int)0x80000000)); Record(40, handle);
                        }
                    }
                    path = current = false;
                    break;
                default: throw new InvalidDataException("지원하지 않는 프린터 벡터 연산입니다.");
            }
            n = 0;
        }
        Check(n == 0 && !path && !emptyDash);
        Record(34, -1);
    }
}
