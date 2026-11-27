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
    internal static void Run()
    {
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
