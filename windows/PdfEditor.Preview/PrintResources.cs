using System.Runtime.InteropServices;
using System.Text.Json;

namespace PdfEditor.Preview;

public partial class MainWindow
{
    private static TabSession? _printPreparationOwner;

    [StructLayout(LayoutKind.Sequential)]
    private struct PrintMemoryStatus
    {
        public uint Length, MemoryLoad;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile;
        public ulong TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref PrintMemoryStatus status);

    private static bool ReadMemoryStatus(out PrintMemoryStatus status)
    {
        status = new PrintMemoryStatus { Length = (uint)Marshal.SizeOf<PrintMemoryStatus>() };
        return GlobalMemoryStatusEx(ref status);
    }

    private static bool IsPhysicalMemoryLow() => ReadMemoryStatus(out var status) &&
        status.AvailablePhysical < Math.Min(status.TotalPhysical / 8, 2UL * 1024 * 1024 * 1024);

    internal static object? GetPrintMemory()
    {
        if (!ReadMemoryStatus(out var status)) return null;
        return new { availablePhysicalBytes = status.AvailablePhysical,
            availableCommitBytes = status.AvailablePageFile, totalPhysicalBytes = status.TotalPhysical,
            memoryLoadPercent = status.MemoryLoad, processorCount = Environment.ProcessorCount };
    }

    private void SendPrintResources(TabSession session, JsonElement root)
    {
        string requestId = GetString(root, "requestId") ?? "";
        try
        {
            if (_printPreparationOwner?.Owner is null) _printPreparationOwner = null;
            string action = GetString(root, "action") ?? "sample";
            if (action == "begin")
            {
                if (_printPreparationOwner is not null)
                    throw new InvalidOperationException("다른 창에서 인쇄를 준비 중입니다. 완료 후 다시 시도하세요.");
                _printPreparationOwner = session;
            }
            else if (action == "end" && _printPreparationOwner == session) _printPreparationOwner = null;
            SendHostCommand(session, new { cmd = "output-result", requestId, ok = true, memory = GetPrintMemory() });
        }
        catch (Exception error)
        { SendHostCommand(session, new { cmd = "output-result", requestId, ok = false, error = error.Message }); }
    }
}
