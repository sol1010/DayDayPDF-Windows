using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using PdfEditor.Preview;

internal static class InstalledFontChecks
{
    public static int Run(string pdf, string webRoot, string script)
    {
        var app = new Application();
        var status = 1;
        var profile = Directory.CreateTempSubdirectory("DaydayFontProbe-");
        var exited = new TaskCompletionSource<bool>();
        app.Startup += async (_, _) =>
        {
            CoreWebView2Controller? controller = null;
            string testId = "pc-font-test-" + Guid.NewGuid().ToString("N");
            string testPage = Path.GetFullPath(Path.Combine(webRoot, testId + ".html"));
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, profile.FullName);
                environment.BrowserProcessExited += (_, _) => exited.TrySetResult(true);
                var handle = (IntPtr)typeof(MainWindow).GetMethod("EnsureControllerParkingHostHandle",
                    BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, null)!;
                controller = await environment.CreateCoreWebView2ControllerAsync(handle);
                controller.Bounds = new System.Drawing.Rectangle(0, 0, 1280, 900);
                controller.IsVisible = false;
                var core = controller.CoreWebView2;
                const string host = "app.pdfeditor.local";
                core.SetVirtualHostNameToFolderMapping(host, Path.GetFullPath(webRoot), CoreWebView2HostResourceAccessKind.DenyCors);
                typeof(MainWindow).Assembly.GetType("PdfEditor.Preview.InstalledFonts")!.GetMethod("Attach",
                    BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, [core, host]);
                var html = await File.ReadAllTextAsync(Path.Combine(webRoot, "view.html"));
                const string marker = "const pwaFileInbox = createPwaFileInbox(";
                if (!html.Contains(marker)) throw new InvalidDataException("Missing test injection point");
                html = html.Replace(marker, await File.ReadAllTextAsync(script) + "\n" + marker);
                await File.WriteAllTextAsync(testPage, html);
                var result = new TaskCompletionSource<string>();
                core.WebMessageReceived += (_, e) => {
                    using var payload = JsonDocument.Parse(e.WebMessageAsJson);
                    if (payload.RootElement.TryGetProperty("pcFontResult", out var value)) result.TrySetResult(value.ToString());
                };
                core.NavigationCompleted += (_, e) => Console.WriteLine("Navigation " + e.WebErrorStatus);
                await core.AddScriptToExecuteOnDocumentCreatedAsync("addEventListener('error',e=>chrome.webview.postMessage({diagnostic:String(e.message||'')}),true);addEventListener('unhandledrejection',e=>chrome.webview.postMessage({diagnostic:String(e.reason?.stack||e.reason)}))");
                core.WebMessageReceived += (_, e) => {
                    using var message = JsonDocument.Parse(e.WebMessageAsJson);
                    if (message.RootElement.TryGetProperty("diagnostic", out var info) && info.ToString().Length > 0) Console.WriteLine(info);
                };
                core.Navigate("https://" + host + "/" + testId + ".html");
                var deadline = DateTime.UtcNow.AddSeconds(75);
                while (await core.ExecuteScriptAsync("typeof runInstalledFontCheck") != "\"function\"")
                {
                    if (DateTime.UtcNow > deadline) throw new TimeoutException("Desktop app did not initialize: " +
                        await core.ExecuteScriptAsync("JSON.stringify([location.href,document.readyState,document.title,document.body?.innerText?.slice(-350),document.documentElement.innerHTML.includes('window.runInstalledFontCheck =')])"));
                    await Task.Delay(200);
                }
                await core.ExecuteScriptAsync("window.pcFontFixture = '" + Convert.ToBase64String(await File.ReadAllBytesAsync(pdf)) + "'");
                await core.ExecuteScriptAsync("Promise.resolve(window.pdfEditorStartupPromise).then(runInstalledFontCheck).then(x=>chrome.webview.postMessage({pcFontResult:x})).catch(e=>chrome.webview.postMessage({pcFontResult:'FAILED '+e.stack}));void 0");
                var report = await result.Task.WaitAsync(TimeSpan.FromMinutes(2));
                Console.WriteLine(report);
                if (report.StartsWith("FAILED")) throw new Exception("Installed font smoke failed");
                status = 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); }
            finally
            {
                controller?.Close();
                File.Delete(testPage);
                await Task.WhenAny(exited.Task, Task.Delay(3000));
                app.Shutdown();
            }
        };
        app.Run();
        if (Path.GetFullPath(profile.Parent!.FullName) == Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) &&
            profile.Name.StartsWith("DaydayFontProbe-", StringComparison.Ordinal))
        {
            try { profile.Delete(recursive: true); }
            catch (IOException) { Console.WriteLine("Test profile still in use: " + profile.FullName); }
        }
        return status;
    }
}
