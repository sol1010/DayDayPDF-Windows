using System.Runtime.InteropServices;
using System.Security.Principal;

internal static class SpoolDocument
{
    [StructLayout(LayoutKind.Sequential)]
    private struct JobInfo
    {
        public uint Id;
        public IntPtr Printer, Machine, User, Document, DataType, StatusText;
        public uint Status, Priority, Position, TotalPages, PagesPrinted;
        public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "EnumJobsW")]
    private static extern bool EnumJobs(IntPtr printer, uint first, uint count, uint level,
        IntPtr buffer, uint length, out uint needed, out uint returned);
    [DllImport("winspool.drv")]
    private static extern bool ClosePrinter(IntPtr printer);

    internal static string? CurrentName()
    {
        if (!OpenPrinter("DaydayPDF", out var printer, IntPtr.Zero)) return null;
        IntPtr data = IntPtr.Zero;
        try
        {
            EnumJobs(printer, 0, 128, 1, IntPtr.Zero, 0, out uint size, out _);
            if (size == 0 || size > 2 * 1024 * 1024) return null;
            data = Marshal.AllocHGlobal((int)size);
            if (!EnumJobs(printer, 0, 128, 1, data, size, out _, out uint count)) return null;
            using var identity = WindowsIdentity.GetCurrent();
            string? result = null;
            int stride = Marshal.SizeOf<JobInfo>();
            for (int i = 0; i < count; i++)
            {
                var job = Marshal.PtrToStructure<JobInfo>(IntPtr.Add(data, i * stride));
                if ((job.Status & 0x10) == 0) continue; // JOB_STATUS_PRINTING
                string? owner = Marshal.PtrToStringUni(job.User);
                if (!string.Equals(owner, identity.Name, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(owner, Environment.UserName, StringComparison.OrdinalIgnoreCase)) continue;
                string? name = Marshal.PtrToStringUni(job.Document);
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (result != null) return null;
                result = name;
            }
            return result;
        }
        finally
        {
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
            ClosePrinter(printer);
        }
    }
}
