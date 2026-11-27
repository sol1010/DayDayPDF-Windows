using System.Diagnostics;
using DaydayPDF.Printing;

namespace DaydayPDF.Printing
{
    internal static class PrintInbox
    {
        internal static string UserKey => Environment.GetEnvironmentVariable("DAYDAY_RECEIVER_TEST")!;
        internal static string Root => Path.Combine(Path.GetTempPath(), UserKey);
        internal static string LegacyRoot => Path.Combine(Root, "documents");
    }
}

namespace DaydayPDF.PrintReceiver
{
    internal static class Program
    {
        private static string FileAt(string name) => Path.Combine(PrintInbox.Root, name);
        private static void Signal(string name) => File.WriteAllText(FileAt(name), "");
        private static bool Take(string name)
        {
            if (!File.Exists(FileAt(name))) return false;
            File.Delete(FileAt(name));
            return true;
        }

        internal static async Task RunAsync(EventWaitHandle ready, uint deferredJob, CancellationToken stop)
        {
            ready.Set();
            while (true)
            {
                ReceiverProgress.At(ReceiverStage.Queue);
                if (Take("exit")) Environment.Exit(42);
                if (Take("stall")) { Signal("stalled"); Thread.Sleep(Timeout.Infinite); }
                if (File.Exists(FileAt("queued"))) File.Move(FileAt("queued"), FileAt("received"));
                await Task.Delay(100, stop);
            }
        }

        private static void WaitFor(Func<bool> done, int seconds)
        {
            var timer = Stopwatch.StartNew();
            while (!done())
            {
                if (timer.Elapsed.TotalSeconds > seconds) throw new TimeoutException();
                Thread.Sleep(100);
            }
        }

        private static int Main(string[] args)
        {
            if (args is ["--worker", var token, var pid, var job])
                return ReceiverSupervisor.Worker(token, int.Parse(pid), uint.Parse(job));
            if (!string.IsNullOrEmpty(PrintInbox.UserKey)) return ReceiverSupervisor.Run();

            ConversionChecks.Run();
            Environment.SetEnvironmentVariable("DAYDAY_RECEIVER_TEST", "DaydayPDF.Test." + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(PrintInbox.Root);
            string log = FileAt("print-receiver.log");
            using var monitor = new Process { StartInfo = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true } };
            try
            {
                Signal("exit"); Signal("queued");
                monitor.Start();
                WaitFor(() => Take("received"), 20);
                if (!File.ReadAllText(log).Contains("code=42")) throw new Exception("Missing worker exit");
                Console.WriteLine("Worker exit: pending item resumed.");

                Signal("stall");
                WaitFor(() => File.Exists(FileAt("stalled")), 5);
                Signal("queued");
                WaitFor(() => Take("received"), 90);
                if (!File.ReadAllText(log).Contains("stage=Queue job=0 seconds=60")) throw new Exception("Missing idle stall");
                Console.WriteLine("Unresponsive worker: pending item resumed.");

                monitor.Kill();
                monitor.WaitForExit();
                WaitFor(() => File.ReadAllText(log).Contains("monitor exited; restarting"), 10);
                Signal("queued");
                WaitFor(() => Take("received"), 20);
                int starts = File.ReadAllLines(log).Count(line => line.Contains("started pid="));
                if (starts < 4 || ReceiverSupervisor.Stop() != 0) throw new Exception("Monitor replacement failed");
                Thread.Sleep(2300);
                if (File.ReadAllLines(log).Count(line => line.Contains("started pid=")) != starts)
                    throw new Exception("Intentional stop restarted a worker");
                Console.WriteLine("Monitor exit: replacement ready. Maintenance stop: no restart.");
                return 0;
            }
            finally
            {
                ReceiverSupervisor.Stop();
                if (monitor.Id != 0) monitor.WaitForExit(10000);
            }
        }
    }
}
