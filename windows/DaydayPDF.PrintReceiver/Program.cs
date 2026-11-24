using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using DaydayPDF.Printing;

namespace DaydayPDF.PrintReceiver;

internal static class Program
{
    private static string EventName(string suffix) => @"Local\DaydayPDF.PrintReceiver." + PrintInbox.UserKey + "." + suffix;

    public static int Main(string[] args)
    {
        if (args.Contains("--stop"))
        {
            try { using var stop = EventWaitHandle.OpenExisting(EventName("Stop")); using var stopped = EventWaitHandle.OpenExisting(EventName("Stopped")); stop.Set(); return stopped.WaitOne(20000) ? 0 : 1; }
            catch (WaitHandleCannotBeOpenedException) { return 0; }
        }
        using var mutex = new Mutex(false, EventName("Mutex"), out bool created);
        if (!created) return 0;
        using var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, EventName("Stop"));
        using var stoppedEvent = new EventWaitHandle(false, EventResetMode.ManualReset, EventName("Stopped"));
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, EventName("Ready"));
        using var cancellation = new CancellationTokenSource();
        var registration = ThreadPool.RegisterWaitForSingleObject(stopEvent, (_, _) => cancellation.Cancel(), null, Timeout.Infinite, true);
        try { RunAsync(ready, cancellation.Token).GetAwaiter().GetResult(); return 0; }
        catch (OperationCanceledException) { return 0; }
        catch (Exception error) { Log(error); return 1; }
        finally { registration.Unregister(null); ready.Reset(); stoppedEvent.Set(); }
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

    private static async Task RunAsync(EventWaitHandle ready, CancellationToken stop)
    {
        var active = new List<Task>();
        var waiting = CreatePipe();
        ready.Set();
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
        finally { waiting.Dispose(); await Task.WhenAll(active); }
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
        using var idle = CancellationTokenSource.CreateLinkedTokenSource(stop);
        idle.CancelAfter(TimeSpan.FromMinutes(3));
        byte[] signature = new byte[5];
        int count = 0;
        while (count < signature.Length)
        {
            int read = await source.ReadAsync(signature.AsMemory(count), idle.Token);
            if (read == 0) return null; // Local-port validation opens an empty connection.
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
                    idle.CancelAfter(TimeSpan.FromMinutes(3));
                    int read = await source.ReadAsync(buffer, idle.Token);
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
