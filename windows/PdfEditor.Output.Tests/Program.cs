using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using PdfEditor.Preview;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args is ["--print-cancel"]) { CheckPendingPrintCancellation().GetAwaiter().GetResult(); return 0; }
        if (args is ["--preview-memory"]) { CheckPreviewMemory(); return 0; }
        if (args is ["--spool-read"]) { SpoolReadChecks.Run().GetAwaiter().GetResult(); return 0; }
        if (args is ["--update-feed"]) { UpdateFeedChecks.Run().GetAwaiter().GetResult(); return 0; }
        if (args is ["--verify-public-release", var version]) { UpdateFeedChecks.VerifyPublic(Version.Parse(version)).GetAwaiter().GetResult(); return 0; }
        if (args.Length > 0 && args[0].StartsWith("--shell-activation", StringComparison.Ordinal)) return ShellActivationChecks.Run(args);
        if (args is ["--installed-fonts", var fontPdf, var webRoot, var testScript])
            return InstalledFontChecks.Run(fontPdf, webRoot, testScript);
        if (args is ["--spool-probe" or "--spool-cancel-probe", var input, var queue, var profile])
            return DesktopSpoolProbe.Run(input, queue, profile, args[0] == "--spool-cancel-probe");
        if (args is ["--print-resource-monitor"]) return PrintResourceProbe.Run();
        if (args is ["--webview-print-probe", var probePdf, var probeDirectory])
            return WebViewPrintProbe.Run(probePdf, probeDirectory);
        if (args is ["--window-sizing"])
        {
            try { WindowSizingChecks.Run(); return 0; }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }
        var tabs = new[] { "a", "b", "c", "d" };
        void Check(string command, string target, string expected) {
            var actual = NativeTabClosePolicy.Select(tabs, target, command, tab => tab is "a" or "c");
            if (string.Join(',', actual) != expected) throw new Exception(command + " selected the wrong tabs");
        }
        Check("close", "b", "b"); Check("others", "b", "a,c,d");
        Check("left", "c", "a,b"); Check("right", "b", "c,d");
        Check("all", "b", "a,b,c,d"); Check("selected", "b", "a,c");
        Check("left", "a", ""); Check("right", "d", ""); Check("all", "missing", "");
        Console.WriteLine("Native tab close policy: 9 checks passed");
        TemporaryPrintChecks.Run();
        if (args is ["--coordinator"])
        {
            using var primary = new SingleInstanceCoordinator();
            if (!primary.TryBecomePrimary(new LaunchRequest("open", Array.Empty<string>()))) throw new Exception("Close the installed test editor before this check");
            using var early = new SingleInstanceCoordinator();
            if (early.TryBecomePrimary(new LaunchRequest("open", new[] { "generated-print-1.pdf" }))) throw new Exception("Second instance became primary");
            Thread.Sleep(100);
            var received = new System.Collections.Concurrent.ConcurrentQueue<string>();
            using var completed = new ManualResetEventSlim();
            primary.RequestReceived += request => { received.Enqueue(request.Files[0]); if (received.Count == 2) completed.Set(); };
            using var later = new SingleInstanceCoordinator();
            if (later.TryBecomePrimary(new LaunchRequest("open", new[] { "generated-print-2.pdf" }))) throw new Exception("Third instance became primary");
            if (!completed.Wait(5000) || !received.SequenceEqual(new[] { "generated-print-1.pdf", "generated-print-2.pdf" })) throw new Exception("Early or running-instance print requests were lost");
            Console.WriteLine("Print launch routing: early startup request retained; running instance receives the next request");
            return 0;
        }
        if (args.Length == 0) return 0;
        bool pdfAndTabs = args[0] == "--pdf-and-tabs";
        if (args.Length != 3 || (!pdfAndTabs && !args[0].StartsWith("DaydayPDF Verification ", StringComparison.Ordinal)))
            throw new ArgumentException("Use only an explicitly named verification printer, PDF input and test profile directory.");
        var application = new Application();
        int result = 1;
        application.Startup += async (_, _) => {
            try {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.GetFullPath(pdfAndTabs ? Path.Combine(args[2], "webview-profile") : args[2]));
                var owner = (MainWindow)RuntimeHelpers.GetUninitializedObject(typeof(MainWindow));
                typeof(MainWindow).GetField("_environment", BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(owner, environment);
                var bytes = await File.ReadAllBytesAsync(args[1]);
                using var buffer = environment.CreateSharedBuffer((ulong)bytes.Length);
                using (var stream = buffer.OpenStream()) await stream.WriteAsync(bytes);
                using var options = JsonDocument.Parse(JsonSerializer.Serialize(new { printer = pdfAndTabs ? "DaydayPDF" : args[0], copies = 1, color = "color", duplex = "single", orientation = "portrait", paper = "a4" }));
                if (pdfAndTabs)
                {
                    Directory.CreateDirectory(args[2]);
                    var print = typeof(MainWindow).GetMethod("PrintDesktopPdfAsync", BindingFlags.NonPublic | BindingFlags.Instance)!;
                    var task = (Task)print.Invoke(owner, new object?[] { buffer, options.RootElement })!;
                    await task;
                    var selection = task.GetType().GetProperty("Result")!.GetValue(task)!;
                    string path = (string)selection.GetType().GetProperty("Path")!.GetValue(selection)!;
                    if (!(bool)selection.GetType().GetProperty("OpenInDaydayPdf")!.GetValue(selection)!) throw new Exception("DaydayPDF must open its print output automatically");
                    var actual = await File.ReadAllBytesAsync(path);
                    if (!bytes.SequenceEqual(actual)) throw new Exception("PDF print changed or truncated bytes");
                    File.Copy(path, Path.GetFullPath(Path.Combine(args[2], "native-printed.pdf")), true);
                    File.Delete(path);
                    Console.WriteLine("DaydayPDF direct print: no save dialog, exact bytes preserved, open-in-app requested");
                    CheckSaveDialog();
                    await CheckParkedTabs(environment);
                }
                else
                {
                    var render = typeof(MainWindow).GetMethod("RenderDesktopPrintAsync", BindingFlags.NonPublic | BindingFlags.Instance)!;
                    await (Task)render.Invoke(owner, new object?[] { buffer, options.RootElement, args[0] })!;
                    Console.WriteLine("Actual print queue: succeeded");
                }
                result = 0;
            } catch (Exception error) { Console.Error.WriteLine(error); }
            finally { application.Shutdown(); }
        };
        application.Run(); return result;
    }

    private static async Task CheckPendingPrintCancellation()
    {
        var wait = typeof(MainWindow).GetMethod("WaitForPrintSubmissionAsync", BindingFlags.Static | BindingFlags.NonPublic)!;
        var submission = new TaskCompletionSource<CoreWebView2PrintStatus>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var cancellation = new CancellationTokenSource();
        var pending = (Task)wait.Invoke(null, new object[] { submission.Task, cancellation.Token })!;
        cancellation.Cancel();
        try
        {
            await pending.WaitAsync(TimeSpan.FromSeconds(2));
            throw new Exception("The pending print was not canceled");
        }
        catch (OperationCanceledException error) when (error.Data.Contains("submitted")) { }
        submission.SetException(new IOException("Driver completed after cancellation"));
        Console.WriteLine("Pending printer submission cancellation: PASS");
    }

    private static void CheckPreviewMemory()
    {
        var session = new TabSession("test", Path.Combine(Path.GetTempPath(), "saved.pdf"));
        var type = typeof(TabSession);
        var canUnload = type.GetProperty("CanUnloadPreview", BindingFlags.Instance | BindingFlags.NonPublic)!;
        bool Eligible() => (bool)canUnload.GetValue(session)!;
        void Set(string name, bool value) => type.GetProperty(name)!.SetValue(session, value);
        if (Eligible()) throw new Exception("Loading tab was eligible");
        Set(nameof(TabSession.ViewReady), true);
        Set(nameof(TabSession.HasDocument), true);
        if (!Eligible()) throw new Exception("Clean tab could not release its preview");
        foreach (string state in new[] { nameof(TabSession.IsDirty), nameof(TabSession.HasHistory), nameof(TabSession.RestoreFromAutosave) })
        {
            Set(state, true);
            if (Eligible()) throw new Exception("Tab lost protection for " + state);
            Set(state, false);
        }
        string printPath = Path.Combine(Path.GetTempPath(), "DaydayPDF", "PrintedDocuments",
            "test_20261124_120000_00000000000000000000000000000001.pdf");
        type.GetProperty(nameof(TabSession.DocPath))!.SetValue(session, printPath);
        if (!session.IsTemporaryPrint || Eligible()) throw new Exception("Unsaved print tab was eligible");
        Console.WriteLine("PASS clean preview release, loading, edits, undo, recovery and unsaved print protection");
    }

    private static void CheckSaveDialog()
    {
        var type = typeof(MainWindow).Assembly.GetType("PdfEditor.Preview.PdfPrintSaveDialog")!;
        object dialog = type.GetMethod("Create", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, new object[] { "printed.pdf" })!;
        try
        {
            var customize = type.GetNestedType("IFileDialogCustomize", BindingFlags.NonPublic)!;
            object?[] state = { (uint)1001, false };
            customize.GetMethod("GetCheckButtonState")!.Invoke(dialog, state);
            if (!Equals(state[1], true)) throw new Exception("Open-in-DaydayPDF must default to checked");
            customize.GetMethod("SetCheckButtonState")!.Invoke(dialog, new object[] { (uint)1001, false });
            customize.GetMethod("GetCheckButtonState")!.Invoke(dialog, state);
            if (!Equals(state[1], false)) throw new Exception("Open-in-DaydayPDF cannot be unchecked");
            Console.WriteLine("Windows save dialog: native PDF filter and DaydayPDF checkbox created; checked/unchecked verified");
        }
        finally { Marshal.FinalReleaseComObject(dialog); }
    }

    private static async Task CheckParkedTabs(CoreWebView2Environment environment)
    {
        var host = (IntPtr)typeof(MainWindow).GetMethod("EnsureControllerParkingHostHandle", BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, null)!;
        for (int i = 0; i < 2; i++)
        {
            var controller = await environment.CreateCoreWebView2ControllerAsync(host);
            try
            {
                controller.IsVisible = false;
                var bounds = new System.Drawing.Rectangle(0, 0, 1200 + i * 100, 800);
                controller.Bounds = bounds;
                var ready = new TaskCompletionSource<bool>();
                controller.CoreWebView2.NavigationCompleted += (_, e) => ready.TrySetResult(e.IsSuccess);
                controller.CoreWebView2.NavigateToString("<html><body><div id='sidebar' style='height:300px;overflow:auto'><div style='height:5000px'>thumbnails</div></div><script>window.onresize=()=>{if(innerWidth<96)document.documentElement.style.setProperty('--panelw','96px')};</script></body></html>");
                if (!await ready.Task.WaitAsync(TimeSpan.FromSeconds(30))) throw new Exception("Test page did not load");
                await controller.CoreWebView2.ExecuteScriptAsync($"document.documentElement.style.setProperty('--panelw','{380+i*120}px');document.getElementById('sidebar').scrollTop={400+i*700};");
                var session = new TabSession("test", null);
                typeof(TabSession).GetProperty("Controller")!.SetValue(session, controller);
                string read = "JSON.stringify([innerWidth,document.documentElement.style.getPropertyValue('--panelw'),document.getElementById('sidebar').scrollTop])";
                string before = await controller.CoreWebView2.ExecuteScriptAsync(read);
                typeof(MainWindow).GetMethod("ParkController", BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, new object[] { session });
                await Task.Delay(100);
                if (controller.Bounds != bounds || await controller.CoreWebView2.ExecuteScriptAsync(read) != before)
                    throw new Exception("Parking a tab reset its viewport, panel width or thumbnail scroll");
            }
            finally { controller.Close(); }
        }
        Console.WriteLine("Two native WebView2 tabs: parked viewport, panel width and scroll preserved");
    }
}
