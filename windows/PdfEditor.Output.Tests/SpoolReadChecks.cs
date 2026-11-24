using System.IO;
using System.IO.Pipes;
using DaydayPDF.PrintReceiver;

internal static class SpoolReadChecks
{
    internal static async Task Run()
    {
        string name = "DayDayPDF-Test-" + Guid.NewGuid().ToString("N");
        using var server = new NamedPipeServerStream(name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        using var client = new NamedPipeClientStream(".", name, PipeDirection.Out, PipeOptions.Asynchronous);
        var connect = server.WaitForConnectionAsync();
        await client.ConnectAsync(5000);
        await connect;
        int checks = 0;
        bool rendering = true;
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var reader = new SpoolReader(server, TimeSpan.FromMilliseconds(60), () => {
            Interlocked.Increment(ref checks);
            return Volatile.Read(ref rendering);
        }, stop.Token);
        foreach (byte value in new byte[] { 37, 80 })
        {
            byte[] buffer = new byte[1];
            int before = Volatile.Read(ref checks);
            var pending = reader.ReadAsync(buffer).AsTask();
            while (Volatile.Read(ref checks) - before < 2) await Task.Delay(10, stop.Token);
            if (pending.IsCompleted) throw new Exception("Renderer lost its connection");
            await client.WriteAsync(new byte[] { value }, stop.Token);
            if (await pending != 1 || buffer[0] != value) throw new Exception("Lost delayed print data");
        }
        Volatile.Write(ref rendering, false);
        try { await reader.ReadAsync(new byte[1]); throw new Exception("Idle client did not time out"); }
        catch (TimeoutException) { }
        using var stopped = new CancellationTokenSource();
        using var other = new SpoolReader(server, TimeSpan.FromMinutes(3), () => true, stopped.Token);
        var read = other.ReadAsync(new byte[1]).AsTask();
        stopped.Cancel();
        try { await read; throw new Exception("Stop failed"); } catch (OperationCanceledException) { }
        Console.WriteLine("PASS delayed first and subsequent print data, idle timeout and receiver stop");
    }
}
