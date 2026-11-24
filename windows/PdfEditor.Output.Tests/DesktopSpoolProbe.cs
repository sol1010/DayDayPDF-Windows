using System.IO;
using System.Printing;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using PdfEditor.Preview;

internal static class DesktopSpoolProbe
{
    internal static int Run(string input, string queueName, string profile, bool cancelRemaining = false)
    {
        using var server = new LocalPrintServer();
        using var queue = server.GetPrintQueue(queueName);
        queue.Refresh();
        if (!queueName.StartsWith("DayDayPDF-QA-") || !queue.IsPaused ||
            queue.QueueDriver.Name != "Microsoft Print To PDF" || !queue.QueuePort.Name.Equals(Path.Combine(Path.GetTempPath(), queueName + ".pdf"), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Use a paused test queue on its own temporary PDF port.");
        var application = new Application();
        int result = 1;
        application.Startup += async (_, _) => {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.GetFullPath(profile));
                byte[] pdf = await File.ReadAllBytesAsync(input);
                using var buffer = environment.CreateSharedBuffer((ulong)pdf.Length);
                using (var stream = buffer.OpenStream()) stream.Write(pdf);
                var media = new[] { new { first = 1, last = 1, width = 595.28, height = 841.89 },
                    new { first = 2, last = 2, width = 1190.55, height = 841.89 } };
                const string title = "검증 25% #2.pdf";
                var options = JsonSerializer.SerializeToElement(new { name = title, pageCount = 2,
                    mediaRuns = media, copies = 1, color = "color", duplex = "single" });
                var print = typeof(MainWindow).GetMethod("RenderDesktopPrintAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
                using var cancellation = new CancellationTokenSource();
                Action<bool, string> status = (canCancel, message) => {
                    Console.WriteLine(message);
                    if (canCancel && cancelRemaining) application.Dispatcher.BeginInvoke(new Action(cancellation.Cancel));
                };
                try {
                    await (Task)print.Invoke(null, new object[] { environment, buffer, options, queueName, cancellation.Token, status })!;
                    if (cancelRemaining) throw new Exception("Remaining batch was not canceled");
                }
                catch (OperationCanceledException error) when (cancelRemaining && error.Data.Contains("submitted")) { }
                queue.Refresh();
                using var jobs = queue.GetPrintJobInfoCollection();
                var names = jobs.Select(job => job.Name).ToArray();
                Console.WriteLine("Queue jobs: " + string.Join(" | ", names));
                if (names.Length != (cancelRemaining ? 1 : 2) || names.Any(name => name != title))
                    throw new Exception("Unexpected spool job name or page-range count");
                result = 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally { application.Shutdown(); }
        };
        application.Run();
        return result;
    }
}
