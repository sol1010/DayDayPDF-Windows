using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;


namespace PdfEditor.Preview;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private static string MutexName => @"Local\DaydayPDF.Editor.v2." + DaydayPDF.Printing.PrintInbox.UserKey;
    private static string PipeName => "DaydayPDF.Editor.v2.Commands." + DaydayPDF.Printing.PrintInbox.UserKey;

    private readonly CancellationTokenSource _cancellation = new();
    private Mutex? _mutex;
    private Task? _listenerTask;

    private readonly object _requestGate = new();
    private readonly Queue<LaunchRequest> _waitingRequests = new();
    private Action<LaunchRequest>? _requestReceived;
    public event Action<LaunchRequest>? RequestReceived
    {
        add
        {
            LaunchRequest[] pending;
            lock (_requestGate) { _requestReceived += value; pending = _waitingRequests.ToArray(); _waitingRequests.Clear(); }
            foreach (var request in pending) value?.Invoke(request);
        }
        remove { lock (_requestGate) _requestReceived -= value; }
    }

    public bool TryBecomePrimary(LaunchRequest request)
    {
        _mutex = new Mutex(initiallyOwned: false, MutexName, out bool createdNew);
        if (createdNew)
        {
            _listenerTask = ListenAsync(_cancellation.Token);
            return true;
        }

        SendToPrimary(request);
        return false;
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

                await server.WaitForConnectionAsync(cancellationToken);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                string json = await ReadRequestAsync(server, timeout.Token);
                LaunchRequest? request = string.IsNullOrWhiteSpace(json)
                    ? null
                    : JsonSerializer.Deserialize<LaunchRequest>(json);
                if (request is not null)
                {
                    Action<LaunchRequest>? handler;
                    lock (_requestGate)
                    {
                        handler = _requestReceived;
                        if (handler is null) _waitingRequests.Enqueue(request);
                    }
                    handler?.Invoke(request);
                    using var writer = new StreamWriter(server, new UTF8Encoding(false));
                    await writer.WriteLineAsync(request.ActivationWindow.ToInt64().ToString());
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
            }
        }
    }

    private static async Task<string> ReadRequestAsync(Stream stream, CancellationToken token)
    {
        const int maxBytes = 512 * 1024;
        using var data = new MemoryStream();
        byte[] chunk = new byte[4096];
        while (true)
        {
            int count = await stream.ReadAsync(chunk, token);
            if (count == 0) throw new EndOfStreamException();
            int newline = Array.IndexOf(chunk, (byte)'\n', 0, count);
            int length = newline >= 0 ? newline : count;
            if (data.Length + length > maxBytes) throw new InvalidDataException();
            data.Write(chunk, 0, length);
            if (newline >= 0) return Encoding.UTF8.GetString(data.GetBuffer(), 0, (int)data.Length).TrimEnd('\r');
        }
    }

    private static NamedPipeClientStream Connect(PipeDirection direction)
    {
        var pipe = new NamedPipeClientStream(".", PipeName, direction, PipeOptions.Asynchronous);
        try { pipe.Connect(500); return pipe; }
        catch { pipe.Dispose(); throw; }
    }

    private static NamedPipeClientStream ConnectToPrimary()
    {
        try { return Connect(PipeDirection.InOut); }
        catch (UnauthorizedAccessException) { return Connect(PipeDirection.Out); }
    }

    private static void SendToPrimary(LaunchRequest request)
    {
        string json = JsonSerializer.Serialize(request);
        Exception? lastError = null;

        for (int attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                using var client = ConnectToPrimary();
                ShellWindowActivation.GrantToPipeServer(client.SafePipeHandle, out uint serverId);
                using var writer = new StreamWriter(client, new UTF8Encoding(false))
                {
                    AutoFlush = true
                };
                writer.WriteLine(json);
                if (!client.CanRead) return;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
                    string? reply = reader.ReadLineAsync(timeout.Token).AsTask().GetAwaiter().GetResult();
                    if (long.TryParse(reply, out long handle) && handle != 0)
                        ShellWindowActivation.ActivateFromLauncher(serverId, new IntPtr(handle));
                }
                catch (Exception error) when (error is IOException or OperationCanceledException) { }
                return;
            }
            catch (Exception error) when (error is IOException or TimeoutException)
            {
                lastError = error;
                Thread.Sleep(150);
            }
        }

        throw new InvalidOperationException("실행 중인 PDF 편집기 Preview에 파일을 전달하지 못했습니다.", lastError);
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        try { _listenerTask?.Wait(TimeSpan.FromSeconds(1)); } catch { }
        _mutex?.Dispose();
        _cancellation.Dispose();
    }
}
