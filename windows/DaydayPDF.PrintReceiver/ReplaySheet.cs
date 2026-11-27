using System.Globalization;
using System.Text;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace DaydayPDF.PrintReceiver;

internal sealed record ReplaySheet(double Width, double Height, double Scale, double Left, double Top)
{
    internal static ReplaySheet? Map(byte[] mode, int[] source, int[] target)
    {
        if (source.Take(6).Any(v => v <= 0) || target.Take(6).Any(v => v <= 0) ||
            source.Skip(6).Any(v => v < 0) || target.Skip(6).Any(v => v < 0))
            throw new InvalidDataException("인쇄 용지 크기를 확인할 수 없습니다.");
        var (width, height) = Paper.PhysicalSize(mode, source);
        double sx = 72d / target[2], sy = 72d / target[3];
        if (Math.Abs(width - target[4] * sx) <= 72d / 25.4 && Math.Abs(height - target[5] * sy) <= 72d / 25.4) return null;
        double scale = Math.Min(target[0] * sx / width, target[1] * sy / height);
        return new(width, height, scale, target[6] * sx, target[7] * sy);
    }

    internal static void Restore(string path, List<ReplaySheet?> sheets, CancellationToken stop)
    {
        if (sheets.All(sheet => sheet is null)) return;
        string corrected = path + ".paper-" + Guid.NewGuid().ToString("N");
        try
        {
            using (var document = PdfReader.Open(path, PdfDocumentOpenMode.Modify))
            {
                if (sheets.Count != document.PageCount) throw new InvalidDataException("변환한 페이지 수가 원본과 다릅니다.");
                for (int i = 0; i < sheets.Count; i++)
                {
                    stop.ThrowIfCancellationRequested();
                    if (sheets[i] is not { } sheet) continue;
                    var page = document.Pages[i];
                    if (page.Rotate != 0) throw new InvalidDataException("Windows PDF의 용지 방향을 확인할 수 없습니다.");
                    double k = 1 / sheet.Scale;
                    double x = -(page.MediaBox.X1 + sheet.Left) * k;
                    double y = sheet.Height - (page.MediaBox.Y2 - sheet.Top) * k;
                    string matrix = string.Create(CultureInfo.InvariantCulture, $"q {k:0.#########} 0 0 {k:0.#########} {x:0.#########} {y:0.#########} cm\n");
                    page.Contents.PrependContent().CreateStream(Encoding.ASCII.GetBytes(matrix));
                    page.Contents.AppendContent().CreateStream("\nQ\n"u8.ToArray());
                    page.MediaBox = new PdfRectangle(new XPoint(0, 0), new XPoint(sheet.Width, sheet.Height));
                    page.CropBox = page.MediaBox;
                }
                document.Save(corrected);
            }
            stop.ThrowIfCancellationRequested();
            File.Move(corrected, path, true);
        }
        finally { if (File.Exists(corrected)) File.Delete(corrected); }
    }
}
