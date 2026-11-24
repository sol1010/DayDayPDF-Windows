using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using PdfEditor.Preview;

internal static class WebViewPrintProbe
{
    public static int Run(string pdf, string directory)
    {
        directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(directory);
        string input = Path.Combine(directory, "document.pdf");
        File.Copy(pdf, input, true);
        var application = new Application();
        int result = 1;
        application.Startup += async (_, _) =>
        {
            CoreWebView2Controller? controller = null;
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "profile"));
                Console.WriteLine("Runtime: " + environment.BrowserVersionString);
                var host = (IntPtr)typeof(MainWindow).GetMethod("EnsureControllerParkingHostHandle", BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, null)!;
                controller = await environment.CreateCoreWebView2ControllerAsync(host);
                controller.IsVisible = false;
                controller.Bounds = new System.Drawing.Rectangle(0, 0, 1200, 900);
                var core = controller.CoreWebView2;
                core.Settings.IsScriptEnabled = false;
                core.Settings.IsWebMessageEnabled = false;
                core.SetVirtualHostNameToFolderMapping("print.pdfeditor.local", directory, CoreWebView2HostResourceAccessKind.Deny);
                core.NavigationStarting += (_, e) => Console.WriteLine("Navigation: " + e.Uri);
                core.ProcessFailed += (_, e) => Console.WriteLine("Process failed: " + e.ProcessFailedKind);
                async Task Navigate(string uri)
                {
                    var ready = new TaskCompletionSource<bool>();
                    void Complete(object? sender, CoreWebView2NavigationCompletedEventArgs e) { Console.WriteLine("Navigation completed: " + e.IsSuccess + " " + e.WebErrorStatus); ready.TrySetResult(e.IsSuccess); }
                    core.NavigationCompleted += Complete;
                    try { core.Navigate(uri); await ready.Task.WaitAsync(TimeSpan.FromSeconds(60)); }
                    finally { core.NavigationCompleted -= Complete; }
                }
                async Task<bool> Print(string name)
                {
                    var settings = environment.CreatePrintSettings();
                    settings.ShouldPrintBackgrounds = true;
                    settings.ShouldPrintHeaderAndFooter = false;
                    settings.MarginTop = settings.MarginBottom = settings.MarginLeft = settings.MarginRight = 0;
                    settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
                    settings.PageWidth = 8.27; settings.PageHeight = 11.69;
                    var watch = Stopwatch.StartNew();
                    bool ok = await core.PrintToPdfAsync(Path.Combine(directory, name + ".pdf"), settings).WaitAsync(TimeSpan.FromSeconds(90));
                    Console.WriteLine($"{name}: {ok}, {watch.ElapsedMilliseconds} ms, bounds={controller.Bounds}, visible={controller.IsVisible}");
                    return ok;
                }
                await Navigate("https://print.pdfeditor.local/document.pdf");
                await Print("before-readiness");
                var timer = Stopwatch.StartNew();
                var prepare = typeof(MainWindow).GetMethod("WaitForDesktopPrintReadyAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
                await (Task)prepare.Invoke(null, new object[] { core, environment, directory, CancellationToken.None })!;
                Console.WriteLine($"Production readiness: {timer.ElapsedMilliseconds} ms");
                if (File.Exists(Path.Combine(directory, "ready.pdf"))) throw new Exception("Readiness probe was not cleaned up");
                if (!await Print("after-readiness")) throw new IOException("Prepared PDF still failed to print");
                result = 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally { controller?.Close(); application.Shutdown(); }
        };
        application.Run();
        return result;
    }
}
