using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using DaydayPDF.Printing;

namespace DaydayPDF.PrintReceiver;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (args is ["--stop"]) return ReceiverSupervisor.Stop();
            if (args is ["--worker", var token, var parent, var deferred] && Guid.TryParseExact(token, "N", out _)
                && int.TryParse(parent, out int pid) && uint.TryParse(deferred, out uint job))
                return ReceiverSupervisor.Worker(token, pid, job);
            return args.Length == 0 ? ReceiverSupervisor.Run() : 1;
        }
        catch (Exception error) { Log(error); return 1; }
    }

    private static NamedPipeServerStream CreatePipe()
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(PrintInbox.PipeName, PipeDirection.In, 4,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 0, security);
    }

    internal static async Task RunAsync(EventWaitHandle ready, uint deferredJob, CancellationToken stop)
    {
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var pipes = ListenPipeAsync(cancel.Token);
        var queue = Task.Run(() => FastPrinter.Listen(OpenInEditor, Log, deferredJob, cancel.Token));
        ready.Set();
        try
        {
            await await Task.WhenAny(pipes, queue);
            stop.ThrowIfCancellationRequested();
            throw new IOException("인쇄 수신 대기가 종료되었습니다.");
        }
        finally
        {
            cancel.Cancel();
            if (stop.IsCancellationRequested) await Task.WhenAll(pipes, queue);
        }
    }

    private static async Task ListenPipeAsync(CancellationToken stop)
    {
        var active = new List<Task>();
        var waiting = CreatePipe();
        try
        {
            while (!stop.IsCancellationRequested)
            {
                await waiting.WaitForConnectionAsync(stop);
                active.RemoveAll(task => task.IsCompleted);
                if (active.Count >= 2) await Task.WhenAny(active).WaitAsync(stop);
                var connected = waiting;
                waiting = CreatePipe();
                active.Add(HandleAsync(connected, stop));
            }
        }
        finally { waiting.Dispose(); if (stop.IsCancellationRequested) await Task.WhenAll(active); }
    }

    private static async Task HandleAsync(NamedPipeServerStream pipe, CancellationToken stop)
    {
        await using (pipe)
        {
            try { string? path = await ReceiveAsync(pipe, stop); if (path is not null) OpenInEditor(path); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            catch (Exception error) { Log(error); }
        }
    }

    internal static async Task<string?> ReceiveAsync(Stream source, CancellationToken stop)
    {
        using var reader = new SpoolReader(source, TimeSpan.FromMinutes(3), SpoolDocument.IsRendering, stop);
        byte[] signature = new byte[5];
        int count = 0;
        while (count < signature.Length)
        {
            int read = await reader.ReadAsync(signature.AsMemory(count));
            if (read == 0 && count == 0) return null;
            if (read == 0) throw new EndOfStreamException();
            count += read;
        }
        if (Encoding.ASCII.GetString(signature) != "%PDF-") throw new InvalidDataException("PDF가 아닌 인쇄 데이터입니다.");
        string path = PrintInbox.NewPath(SpoolDocument.CurrentName()), staging = path + ".partial";
        try
        {
            await using (var destination = new FileStream(staging, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65536, true))
            {
                await destination.WriteAsync(signature, stop);
                byte[] buffer = new byte[65536];
                long length = 5;
                while (true)
                {
                    int read = await reader.ReadAsync(buffer);
                    if (read == 0) break;
                    length += read;
                    if (length > 512L * 1024 * 1024) throw new IOException("인쇄 문서가 지원 크기(512 MB)를 넘었습니다.");
                    await destination.WriteAsync(buffer.AsMemory(0, read), stop);
                }
                await destination.FlushAsync(stop);
                destination.Position = Math.Max(0, destination.Length - 4096);
                byte[] tail = new byte[destination.Length - destination.Position];
                await destination.ReadExactlyAsync(tail, stop);
                if (!Encoding.ASCII.GetString(tail).Contains("%%EOF", StringComparison.Ordinal)) throw new InvalidDataException("인쇄 PDF 수신이 완료되지 않았습니다.");
            }
            stop.ThrowIfCancellationRequested();
            File.Move(staging, path);
            return path;
        }
        finally { if (File.Exists(staging)) File.Delete(staging); }
    }

    private static void OpenInEditor(string path)
    {
        string executable = Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, "DaydayPDF.exe");
        if (!File.Exists(executable)) throw new FileNotFoundException("DaydayPDF 실행 파일을 찾지 못했습니다.");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("--open"); start.ArgumentList.Add(path);
        Process.Start(start)?.Dispose();
    }

    private static void Log(Exception error)
    {
        try { Directory.CreateDirectory(PrintInbox.Root); File.WriteAllText(Path.Combine(PrintInbox.Root, "receiver-error.txt"), DateTime.Now + " " + error.GetType().Name + ": " + error.Message); } catch { }
    }
}
