using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using DaydayPDF.Printing;
using Microsoft.Win32.SafeHandles;

namespace DaydayPDF.PrintReceiver;

internal enum ReceiverStage { Starting, Queue, Reading, Converting, Opening, Acknowledging }

internal static class ReceiverSupervisor
{
    private const int PollMs = 1000;
    internal static string Name(string suffix) => @"Local\DaydayPDF.PrintReceiver." + PrintInbox.UserKey + "." + suffix;

    private sealed class ExitSignal : WaitHandle
    {
        internal ExitSignal(Process process) => SafeWaitHandle = new SafeWaitHandle(process.Handle, false);
    }

    private static Process Start(params string[] args)
    {
        var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        return Process.Start(info) ?? throw new IOException("수신기 실행에 실패했습니다.");
    }

    internal static int Stop()
    {
        try
        {
            using var stop = EventWaitHandle.OpenExisting(Name("Stop"));
            using var stopped = EventWaitHandle.OpenExisting(Name("Stopped"));
            stop.Set();
            return stopped.WaitOne(20000) ? 0 : 1;
        }
        catch (WaitHandleCannotBeOpenedException) { return 0; }
    }

    internal static int Run()
    {
        using var singleton = new Mutex(false, Name("Mutex"), out bool created);
        if (!created) return 0;
        using var stop = new EventWaitHandle(false, EventResetMode.ManualReset, Name("Stop"));
        using var stopped = new EventWaitHandle(false, EventResetMode.ManualReset, Name("Stopped"));
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, Name("Ready"));
        uint deferJob = 0;
        int delay = 1;
        try
        {
            while (!stop.WaitOne(0))
            {
                ready.Reset();
                var uptime = Stopwatch.StartNew();
                try { Watch(stop, ref deferJob); }
                catch (Exception error) { Record("monitor " + error.GetType().Name); }
                ready.Reset();
                if (uptime.Elapsed.TotalSeconds >= 60) delay = 1;
                if (stop.WaitOne(delay * 1000)) break;
                delay = Math.Min(30, delay * 2);
            }
            return 0;
        }
        finally { ready.Reset(); stopped.Set(); }
    }

    private static void Watch(EventWaitHandle stop, ref uint deferJob)
    {
        string token = Guid.NewGuid().ToString("N");
        using var map = MemoryMappedFile.CreateNew(Name(token), 16);
        using var state = map.CreateViewAccessor();
        using var quit = new EventWaitHandle(false, EventResetMode.ManualReset, Name(token + ".Quit"));
        using var process = Start("--worker", token, Environment.ProcessId.ToString(), deferJob.ToString());
        using var exit = new ExitSignal(process);
        WaitHandle[] handles = [stop, exit];
        Record($"started pid={process.Id}");
        long last = -1;
        int quiet = 0;
        try
        {
            while (true)
            {
                int signal = WaitHandle.WaitAny(handles, PollMs);
                if (signal == 0) return;
                var stage = (ReceiverStage)state.ReadInt32(8);
                uint job = state.ReadUInt32(12);
                if (signal == 1)
                {
                    Record($"exited pid={process.Id} code={process.ExitCode} stage={stage} job={job}");
                    if (job != 0) deferJob = job;
                    return;
                }
                long current = state.ReadInt64(0);
                quiet = current == last ? quiet + 1 : 0;
                last = current;
                if (quiet < (job == 0 ? 60 : 480)) continue;
                Record($"stalled pid={process.Id} stage={stage} job={job} seconds={quiet}");
                deferJob = job;
                return;
            }
        }
        finally
        {
            quit.Set();
            if (!process.WaitForExit(6000))
            {
                try { process.Kill(); }
                catch (InvalidOperationException) when (process.HasExited) { }
                process.WaitForExit();
            }
        }
    }

    internal static int Worker(string token, int parentId, uint deferJob)
    {
        using var map = MemoryMappedFile.OpenExisting(Name(token));
        using var state = map.CreateViewAccessor();
        using var quit = EventWaitHandle.OpenExisting(Name(token + ".Quit"));
        using var parent = Process.GetProcessById(parentId);
        using var parentExit = new ExitSignal(parent);
        using var worker = new Mutex(false, Name("Worker"), out bool unique);
        if (!unique) return 1;
        using var ready = EventWaitHandle.OpenExisting(Name("Ready"));
        using var cancel = new CancellationTokenSource();
        var parentWatch = ThreadPool.RegisterWaitForSingleObject(parentExit, (_, _) =>
        {
            if (!quit.WaitOne(0))
            {
                Record("monitor exited; restarting");
                try { Start().Dispose(); }
                finally { Environment.Exit(1); }
            }
        }, null, Timeout.Infinite, true);
        var quitWatch = ThreadPool.RegisterWaitForSingleObject(quit, (_, _) => cancel.Cancel(), null, Timeout.Infinite, true);
        try
        {
            ReceiverProgress.Attach(state);
            Program.RunAsync(ready, deferJob, cancel.Token).GetAwaiter().GetResult();
            return 0;
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { return 0; }
        finally { quitWatch.Unregister(null); parentWatch.Unregister(null); }
    }

    private static void Record(string message)
    {
        try
        {
            string dir = Path.GetDirectoryName(PrintInbox.LegacyRoot)!;
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "print-receiver.log");
            if (File.Exists(path) && new FileInfo(path).Length >= 131072) File.Move(path, path + ".1", true);
            File.AppendAllText(path, $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

internal static class ReceiverProgress
{
    private static MemoryMappedViewAccessor? state;
    private static long last;
    internal static void Attach(MemoryMappedViewAccessor view) => state = view;
    internal static void At(ReceiverStage stage, uint job = 0)
    {
        state?.Write(8, (int)stage);
        state?.Write(12, job);
        state?.Write(0, last = Environment.TickCount64);
    }
    internal static void Advanced()
    {
        long now = Environment.TickCount64;
        if (now - last >= 1000) state?.Write(0, last = now);
    }
}
