using System.IO;

namespace DaydayPDF.PrintReceiver;

internal sealed class SpoolReader(Stream source, TimeSpan idle, Func<bool> isRendering, CancellationToken stop) : IDisposable
{
    private readonly CancellationTokenSource _connection = CancellationTokenSource.CreateLinkedTokenSource(stop);

    internal async ValueTask<int> ReadAsync(Memory<byte> buffer)
    {
        var read = source.ReadAsync(buffer, _connection.Token);
        if (read.IsCompletedSuccessfully) return read.Result;
        var pending = read.AsTask();
        while (true)
        {
            try { return await pending.WaitAsync(idle, stop); }
            catch (TimeoutException)
            {
                if (pending.IsCompleted) return await pending;
                if (isRendering()) continue;
                await _connection.CancelAsync();
                try { return await pending; }
                catch (OperationCanceledException) when (!stop.IsCancellationRequested)
                {
                    throw new TimeoutException("인쇄 대기열에 진행 중인 작업이 없어 수신 대기를 종료했습니다.");
                }
            }
        }
    }

    public void Dispose() => _connection.Dispose();
}
