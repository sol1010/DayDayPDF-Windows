using System.IO;
using System.Diagnostics;
using System.Printing;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using DaydayPDF.Printing;

namespace PdfEditor.Preview;

public partial class MainWindow
{
    private sealed record OutputTransfer(TabSession Session, CoreWebView2SharedBuffer Buffer,
        JsonElement Options, DateTime Created);
    private readonly Dictionary<string, OutputTransfer> _outputTransfers = new();
    private sealed record PrintMediaRun(int First, int Last, double Width, double Height);
    private CancellationTokenSource? _activePrint;
    private TabSession? _printOwner;
    private string? _printRequestId;
    private readonly Dictionary<string, string> _savedOutputPdfs = new();

    private object GetDesktopPrinters()
    {
        using var server = new LocalPrintServer();
        using var queues = server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections });
        string defaultName = "";
        try { using var defaultQueue = LocalPrintServer.GetDefaultPrintQueue(); defaultName = defaultQueue.FullName; } catch { }
        return queues.Select(q => new { name = q.FullName, isDefault = q.FullName == defaultName,
            isPdf = q.QueueDriver?.Name == "Microsoft Print To PDF" || PrintInbox.IsDaydayPrinter(q.FullName, q.QueueDriver?.Name, q.QueuePort?.Name, q.Comment) }).ToArray();
    }

    private void BeginOutputTransfer(TabSession session, JsonElement root)
    {
        string requestId = GetString(root, "requestId") ?? "";
        try
        {
            foreach (var pair in _outputTransfers.ToArray())
                if (pair.Value.Created < DateTime.UtcNow.AddMinutes(-5) || pair.Value.Session.WebView is null)
                { pair.Value.Buffer.Close(); _outputTransfers.Remove(pair.Key); }
            long size = GetInt64(root, "size");
            if (_environment is null || session.WebView is null || requestId.Length is < 1 or > 100 ||
                size <= 0 || size > 512L * 1024 * 1024 || _outputTransfers.Count >= 4 ||
                _outputTransfers.ContainsKey(requestId)) throw new InvalidOperationException("출력 데이터를 받을 수 없습니다.");
            string operation = GetString(root, "operation") ?? "";
            if (operation is not ("print" or "save-copy")) throw new InvalidOperationException("지원하지 않는 출력 작업입니다.");
            var buffer = _environment.CreateSharedBuffer((ulong)size);
            _outputTransfers.Add(requestId, new(session, buffer, root.Clone(), DateTime.UtcNow));
            session.WebView.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadWrite,
                JsonSerializer.Serialize(new { cmd = "output-buffer", requestId, size }));
        }
        catch (Exception error)
        { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, error = error.Message }); }
    }

    private async Task CompleteOutputTransferAsync(TabSession session, string requestId)
    {
        if (!_outputTransfers.TryGetValue(requestId, out var transfer) || transfer.Session != session) return;
        _outputTransfers.Remove(requestId);
        try
        {
            if (GetString(transfer.Options, "operation") == "print")
            {
                var saved = await PrintDesktopPdfAsync(transfer.Buffer, transfer.Options, session, requestId);
                if (saved?.OpenInDaydayPdf == true) await OpenPathsAsync(new[] { saved.Path });
                SendHostCommand(session, new { cmd = "output-result", requestId, ok = true,
                    savedPdf = saved is not null && !PrintInbox.Contains(saved.Path),
                    openedPdf = saved?.OpenInDaydayPdf == true });
                return;
            }
            else
            {
                string name = Path.GetFileName(GetString(transfer.Options, "name") ?? "document.pdf");
                string extension = Path.GetExtension(name).ToLowerInvariant();
                if (!new[] { ".pdf", ".pptx", ".docx", ".xlsx", ".hwp", ".hwpx", ".png", ".jpg", ".webp", ".zip" }.Contains(extension))
                    throw new InvalidOperationException("지원하지 않는 저장 형식입니다.");
                var dialog = new SaveFileDialog { FileName = name, DefaultExt = extension,
                    AddExtension = true, OverwritePrompt = true, Filter = $"{extension[1..].ToUpperInvariant()} 파일|*{extension}" };
                if (dialog.ShowDialog(this) != true)
                { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, canceled = true }); return; }
                if (TabRegistry.All.Values.Any(tab => PathsEqual(tab.DocPath, dialog.FileName)))
                    throw new IOException("편집 중인 원본과 다른 이름으로 저장하세요.");
                await WriteSharedBufferAtomicallyAsync(transfer.Buffer, dialog.FileName);
                if (extension == ".pdf")
                {
                    if (_savedOutputPdfs.Count >= 24) _savedOutputPdfs.Remove(_savedOutputPdfs.Keys.First());
                    _savedOutputPdfs[requestId] = dialog.FileName;
                }
            }
            SendHostCommand(session, new { cmd = "output-result", requestId, ok = true });
        }
        catch (OperationCanceledException error)
        { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, canceled = true, submitted = error.Data.Contains("submitted") }); }
        catch (Exception error)
        { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, error = error.Message }); }
        finally { transfer.Buffer.Close(); }
    }

    private void CancelOutput(TabSession session, string id)
    {
        if (_printOwner == session && _printRequestId == id) _activePrint?.Cancel();
        else if (_outputTransfers.TryGetValue(id, out var transfer) && transfer.Session == session &&
                 GetString(transfer.Options, "operation") == "print")
        {
            _outputTransfers.Remove(id);
            transfer.Buffer.Close();
            SendHostCommand(session, new { cmd = "output-result", requestId = id, ok = false, canceled = true });
        }
    }

    private async Task<PdfPrintSaveDialog.Selection?> PrintDesktopPdfAsync(CoreWebView2SharedBuffer buffer, JsonElement options,
        TabSession session, string requestId)
    {
        if (_activePrint is not null || _environment is null) throw new InvalidOperationException("다른 인쇄 작업이 진행 중입니다.");
        string printer = GetString(options, "printer") ?? "";
        bool pdfPrinter, daydayPrinter;
        using (var server = new LocalPrintServer())
        using (var queues = server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections }))
        {
            var queue = queues.FirstOrDefault(q => q.FullName == printer)
                ?? throw new InvalidOperationException("선택한 프린터를 찾을 수 없습니다.");
            daydayPrinter = PrintInbox.IsDaydayPrinter(queue.FullName, queue.QueueDriver?.Name, queue.QueuePort?.Name, queue.Comment);
            pdfPrinter = daydayPrinter || queue.QueueDriver?.Name == "Microsoft Print To PDF";
        }
        int copies = GetInt32(options, "copies");
        if (copies is < 1 or > 999) throw new InvalidOperationException("인쇄 매수는 1~999 사이로 입력하세요.");
        using (var source = buffer.OpenStream())
        {
            byte[] signature = new byte[5];
            source.ReadExactly(signature);
            if (Encoding.ASCII.GetString(signature) != "%PDF-") throw new InvalidDataException("올바른 PDF 인쇄 데이터가 아닙니다.");
        }
        using var cancel = new CancellationTokenSource();
        _activePrint = cancel;
        _printOwner = session;
        _printRequestId = requestId;
        void Progress(bool canCancel, string message) => SendHostCommand(session,
            new { cmd = "output-progress", requestId, canCancel, message });
        try
        {
            PdfPrintSaveDialog.Selection? selection = null;
            if (pdfPrinter)
            {
                string name = Path.GetFileName(GetString(options, "name") ?? "document.pdf");
                selection = daydayPrinter
                    ? new PdfPrintSaveDialog.Selection(PrintInbox.NewPath(name), true)
                    : PdfPrintSaveDialog.Show(this, name) ?? throw new OperationCanceledException();
                RequireSafePrintedPdfPath(selection.Path);
                Progress(true, "PDF 저장 중 · Esc로 취소");
                await WriteSharedBufferAtomicallyAsync(buffer, selection.Path, cancel.Token);
                return selection;
            }
            await RenderDesktopPrintAsync(_environment, buffer, options, printer, cancel.Token, Progress);
            return selection;
        }
        finally { _activePrint = null; _printOwner = null; _printRequestId = null; }
    }

    private static void RequireSafePrintedPdfPath(string path)
    {
        if (!Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase))
            throw new IOException("PDF 확장자로 저장하세요.");
        if (TabRegistry.All.Values.Any(tab => PathsEqual(tab.DocPath, path)))
            throw new IOException("편집 중인 원본과 다른 이름으로 저장하세요.");
    }

    private static string PrintFileName(string? name)
    {
        string stem = Path.GetFileNameWithoutExtension(Path.GetFileName(name ?? ""));
        stem = string.Concat(stem.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)).Trim().TrimEnd('.');
        if (stem.Length > 110) stem = stem[..(char.IsHighSurrogate(stem[109]) ? 109 : 110)].TrimEnd();
        if (string.IsNullOrWhiteSpace(stem)) stem = "인쇄 문서";
        string first = stem.Split('.')[0].ToUpperInvariant();
        if (first is "AUX" or "NUL" or "CON" or "PRN" ||
            ((first.StartsWith("COM") || first.StartsWith("LPT")) && first.Length == 4)) stem = "_" + stem;
        return stem + ".pdf";
    }

    private static List<PrintMediaRun> ReadPrintMedia(JsonElement options)
    {
        int count = GetInt32(options, "pageCount");
        var runs = new List<PrintMediaRun>();
        if (!options.TryGetProperty("mediaRuns", out var media) || media.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("인쇄 용지 정보가 없습니다.");
        int next = 1;
        foreach (var row in media.EnumerateArray())
        {
            int first = GetInt32(row, "first"), last = GetInt32(row, "last");
            double width = row.GetProperty("width").GetDouble(), height = row.GetProperty("height").GetDouble();
            if (first != next || last < first || last > count || !double.IsFinite(width) || !double.IsFinite(height) ||
                width <= 0 || height <= 0) throw new InvalidDataException("인쇄 용지 정보를 확인하세요.");
            runs.Add(new(first, last, width, height));
            next = checked(last + 1);
        }
        if (runs.Count == 0 || runs[^1].Last != count) throw new InvalidDataException("인쇄 페이지 수를 확인하세요.");
        return runs;
    }

    private static async Task RenderDesktopPrintAsync(CoreWebView2Environment environment, CoreWebView2SharedBuffer buffer, JsonElement options, string printer,
        CancellationToken token, Action<bool, string> progress)
    {
        string jobDirectory = Path.Combine(Path.GetTempPath(), "DaydayPDF", "Print", Guid.NewGuid().ToString("N"));
        var media = ReadPrintMedia(options);
        string name = PrintFileName(GetString(options, "name"));
        string path = Path.Combine(jobDirectory, name);
        int submitted = 0;
        CoreWebView2Controller? controller = null;
        try
        {
            Directory.CreateDirectory(jobDirectory);
            using (var source = buffer.OpenStream())
            await using (var spool = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await source.CopyToAsync(spool, 1024 * 1024, token);
            }
            controller = await environment.CreateCoreWebView2ControllerAsync(EnsureControllerParkingHostHandle());
            token.ThrowIfCancellationRequested();
            controller.Bounds = new System.Drawing.Rectangle(0, 0, 1200, 900);
            controller.IsVisible = false;
            var core = controller.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.IsScriptEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            const string jobHost = "print.pdfeditor.local";
            var uri = new Uri("https://" + jobHost + "/" + Uri.EscapeDataString(name));
            core.SetVirtualHostNameToFolderMapping(jobHost, jobDirectory, CoreWebView2HostResourceAccessKind.Deny);
            core.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target != uri) e.Cancel = true; };
            var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            core.NavigationCompleted += (_, e) => ready.TrySetResult(e.IsSuccess);
            core.Navigate(uri.AbsoluteUri);
            if (!await ready.Task.WaitAsync(TimeSpan.FromSeconds(60), token)) throw new IOException("인쇄할 PDF를 열지 못했습니다.");
            await WaitForDesktopPrintReadyAsync(core, environment, jobDirectory, token);
            await core.ExecuteScriptAsync("document.title = " + JsonSerializer.Serialize(name));
            var settings = environment.CreatePrintSettings();
            settings.PrinterName = printer;
            int copies = GetInt32(options, "copies");
            settings.Copies = media.Count == 1 ? copies : 1;
            settings.HeaderTitle = name;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            settings.MarginTop = settings.MarginBottom = settings.MarginLeft = settings.MarginRight = 0;
            settings.ColorMode = GetString(options, "color") == "mono" ? CoreWebView2PrintColorMode.Grayscale : CoreWebView2PrintColorMode.Color;
            settings.Duplex = GetString(options, "duplex") switch {
                "long" => CoreWebView2PrintDuplex.TwoSidedLongEdge, "short" => CoreWebView2PrintDuplex.TwoSidedShortEdge,
                _ => CoreWebView2PrintDuplex.OneSided };
            settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
            int batches = media.Count == 1 ? 1 : copies;
            for (int copy = 0; copy < batches; copy++)
            {
                foreach (var run in media)
                {
                    token.ThrowIfCancellationRequested();
                    bool landscape = run.Width > run.Height;
                    settings.Orientation = landscape ? CoreWebView2PrintOrientation.Landscape : CoreWebView2PrintOrientation.Portrait;
                    settings.PageWidth = Math.Min(run.Width, run.Height) / 72;
                    settings.PageHeight = Math.Max(run.Width, run.Height) / 72;
                    if (media.Count > 1) settings.PageRanges = $"{run.First}-{run.Last}";
                    progress(true, "프린터 전송 중 · Esc로 남은 전송 취소");
                    var status = await WaitForPrintSubmissionAsync(core.PrintAsync(settings), token);
                    if (status != CoreWebView2PrintStatus.Succeeded)
                        throw new IOException($"{name} · {run.First}–{run.Last}쪽 전송 실패 ({status}). 대기열을 확인하세요.");
                    submitted++;
                }
            }
        }
        catch (OperationCanceledException error)
        {
            if (submitted > 0) error.Data["submitted"] = true;
            throw;
        }
        finally
        {
            controller?.Close();
            try { File.Delete(path); Directory.Delete(jobDirectory); } catch { }
        }
    }

    internal static async Task<CoreWebView2PrintStatus> WaitForPrintSubmissionAsync(
        Task<CoreWebView2PrintStatus> submission, CancellationToken token)
    {
        try { return await submission.WaitAsync(token); }
        catch (OperationCanceledException error) when (token.IsCancellationRequested)
        {
            error.Data["submitted"] = true;
            _ = submission.ContinueWith(task => { _ = task.Exception; }, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            throw;
        }
    }

    internal static async Task WaitForDesktopPrintReadyAsync(CoreWebView2 core,
        CoreWebView2Environment environment, string jobDirectory, CancellationToken token = default)
    {
        string probePath = Path.Combine(jobDirectory, Guid.NewGuid().ToString("N") + ".probe.pdf");
        var probe = environment.CreatePrintSettings();
        probe.PageRanges = "1";
        probe.ShouldPrintBackgrounds = true;
        probe.ShouldPrintHeaderAndFooter = false;
        var watch = Stopwatch.StartNew();
        var limit = TimeSpan.FromSeconds(60);
        try
        {
            while (watch.Elapsed < limit)
            {
                token.ThrowIfCancellationRequested();
                TimeSpan remaining = limit - watch.Elapsed;
                if (remaining <= TimeSpan.Zero) break;
                if (await core.PrintToPdfAsync(probePath, probe).WaitAsync(remaining, token)) return;
                await Task.Delay(250, token);
            }
            throw new TimeoutException();
        }
        catch (TimeoutException error)
        {
            throw new IOException("PDF 인쇄 엔진의 준비 시간이 초과되었습니다. 문서를 다시 연 뒤 시도하세요.", error);
        }
        finally
        {
            try { File.Delete(probePath); } catch { }
        }
    }
}
