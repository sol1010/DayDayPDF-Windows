extern alias receiver;
using System.Buffers.Binary;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using ReplaySheet = receiver::DaydayPDF.PrintReceiver.ReplaySheet;
using Retry = receiver::DaydayPDF.PrintReceiver.FastPrinter.Retry;

namespace DaydayPDF.PrintReceiver;

internal static class ConversionChecks
{
    internal static void Replay(string spool, string modeFile, string output)
    {
        if (File.Exists(output)) throw new IOException("Output already exists");
        var mode = File.ReadAllBytes(modeFile);
        using var replay = new receiver::DaydayPDF.PrintReceiver.WindowsPdfReplay(output, "DaydayPDF replay");
        using var input = File.OpenRead(spool);
        receiver::DaydayPDF.PrintReceiver.FastPrinter.ReadPages(input, mode, 0, replay.ReadFonts, default, ignoreModeChanges: true);
        input.Position = 0;
        receiver::DaydayPDF.PrintReceiver.FastPrinter.ReadPages(input, mode, 0, replay.Page, default, true);
        replay.Finish(default);
    }

    private static void MixedVectorChecks()
    {
        static byte[] Escape(string part)
        {
            byte[] bytes = System.Text.Encoding.ASCII.GetBytes(part);
            var record = new byte[(18 + bytes.Length + 3) & ~3];
            BitConverter.GetBytes(106).CopyTo(record, 0);
            BitConverter.GetBytes(record.Length).CopyTo(record, 4);
            BitConverter.GetBytes(19).CopyTo(record, 8);
            BitConverter.GetBytes(bytes.Length + 2).CopyTo(record, 12);
            BitConverter.GetBytes((ushort)bytes.Length).CopyTo(record, 16);
            bytes.CopyTo(record, 18);
            return record;
        }
        static byte[] Page(params byte[][] items)
        {
            var header = new byte[88]; BitConverter.GetBytes(1).CopyTo(header, 0);
            BitConverter.GetBytes(88).CopyTo(header, 4); " EMF"u8.CopyTo(header.AsSpan(40));
            BitConverter.GetBytes((ushort)1).CopyTo(header, 56);
            byte[] eof = [14, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0];
            var source = items.Prepend(header).Append(eof).SelectMany(x => x).ToArray();
            BitConverter.GetBytes(source.Length).CopyTo(source, 48);
            BitConverter.GetBytes(items.Length + 2).CopyTo(source, 52);
            return source;
        }
        static byte[] Prepare(byte[] page) => receiver::DaydayPDF.PrintReceiver.MixedEmfPage.Prepare(page, page.Length, default);
        byte[] marker = [25, 0, 0, 0, 12, 0, 0, 0, 255, 255, 255, 0];
        byte[] ordinary = Page(marker);
        if (!ReferenceEquals(ordinary, Prepare(ordinary))) throw new Exception("Ordinary EMF was rewritten");
        byte[] drawing = Prepare(Page(Escape("GpPBeg1\r\n0 0 0 SC 5 setlinewidth 8 setmiterlimit NP 0 0 m 10 "),
            Escape("10 l stroke\r\nGSE\r\n")));
        List<int> types = [];
        for (int at = 0; at < drawing.Length; at += BitConverter.ToInt32(drawing, at + 4))
        {
            int type = BitConverter.ToInt32(drawing, at);
            types.Add(type);
            if (type == 58 && BitConverter.ToInt32(drawing, at + 8) != 8) throw new Exception("Incorrect wire miter limit");
        }
        if (!types.Contains(64) || types.Contains(106) || types.Count != BitConverter.ToInt32(drawing, 52) ||
            drawing.Length != BitConverter.ToInt32(drawing, 48)) throw new Exception("Vector playback stream incomplete");
        foreach (var invalid in new[] { "GpPBeg1\r\nNP 0 0 m", "GpPBeg1\r\nunknown\r\nGSE\r\n" })
        {
            try { Prepare(Page(Escape(invalid))); throw new Exception("Unsupported drawing accepted"); }
            catch (InvalidDataException) { }
        }
    }

    internal static void Run()
    {
        MixedVectorChecks();
        foreach (var (status, allowed) in new (uint, bool)[] { (0x2018, true), (0x80, true), (0x1080, true), (0x1000, false), (0x1008, false), (0x1004, false) })
            if (receiver::DaydayPDF.PrintReceiver.FastPrinter.CanReceive(status) != allowed)
                throw new Exception($"Unexpected virtual queue state {status:X}");
        byte[] mode = new byte[220];
        BinaryPrimitives.WriteInt32LittleEndian(mode.AsSpan(72), 15);
        BinaryPrimitives.WriteInt16LittleEndian(mode.AsSpan(76), 1);
        BinaryPrimitives.WriteInt16LittleEndian(mode.AsSpan(78), 256);
        BinaryPrimitives.WriteInt16LittleEndian(mode.AsSpan(80), 3210);
        BinaryPrimitives.WriteInt16LittleEndian(mode.AsSpan(82), 2160);
        int[] caps = [2400, 3200, 300, 300, 2550, 3300, 75, 50];
        var mapping = ReplaySheet.Map(mode, caps, caps) ?? throw new Exception("Custom media not corrected");
        string path = Path.Combine(Path.GetTempPath(), $"Dayday-print-test-{Guid.NewGuid():N}.pdf");
        try
        {
            using (var file = new PdfDocument())
            {
                for (int i = 0; i < 2; i++)
                {
                    var page = file.AddPage();
                    page.MediaBox = new PdfRectangle(new XPoint(0,0), new XPoint(612,792));
                    page.Contents.AppendContent().CreateStream("10 10 100 100 re f\n"u8.ToArray());
                }
                file.Save(path);
            }
            ReplaySheet.Restore(path, [null, mapping], default);
            using var result = PdfReader.Open(path, PdfDocumentOpenMode.Import);
            if (result.PageCount != 2 || result.Pages[0].MediaBox.Width != 612 ||
                Math.Abs(result.Pages[1].MediaBox.Width * 25.4 / 72 - 216) > .01 ||
                Math.Abs(result.Pages[1].MediaBox.Height * 25.4 / 72 - 321) > .01)
                throw new Exception("Vector media round-trip failed");
        }
        finally { File.Delete(path); }
        var retry = Retry.After(null, 200, 3, 0);
        if (!retry.Wait(200, 3, 1) || retry.Wait(201, 3, 1)) throw new Exception("Growing job blocked");
        retry = Retry.After(retry, 200, 3, retry.Next);
        retry = Retry.After(retry, 200, 3, retry.Next);
        if (!retry.Notified || retry.Wait(200, 3, retry.Next)) throw new Exception("Retained job blocked permanently");
        Console.WriteLine("PASS vector custom media, mixed pages and retained job retries");
    }
}
