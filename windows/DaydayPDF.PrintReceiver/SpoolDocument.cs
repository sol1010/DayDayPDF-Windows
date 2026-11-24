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

    internal static string? CurrentName() => InspectJobs().Name;
    internal static bool IsRendering() => InspectJobs().Rendering;

    private static (bool Rendering, string? Name) InspectJobs()
    {
        if (!OpenPrinter("DaydayPDF", out var printer, IntPtr.Zero)) return default;
        IntPtr data = IntPtr.Zero;
        try
        {
            EnumJobs(printer, 0, 128, 1, IntPtr.Zero, 0, out uint size, out _);
            if (size == 0 || size > 2 * 1024 * 1024) return default;
            data = Marshal.AllocHGlobal((int)size);
            if (!EnumJobs(printer, 0, 128, 1, data, size, out _, out uint count)) return default;
            using var identity = WindowsIdentity.GetCurrent();
            bool rendering = false, ambiguous = false;
            string? result = null;
            int stride = Marshal.SizeOf<JobInfo>();
            for (int i = 0; i < count; i++)
            {
                var job = Marshal.PtrToStructure<JobInfo>(IntPtr.Add(data, i * stride));
                string? owner = Marshal.PtrToStringUni(job.User);
                if (!string.Equals(owner, identity.Name, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(owner, Environment.UserName, StringComparison.OrdinalIgnoreCase)) continue;
                const uint spooling = 0x08, printing = 0x10, renderingLocally = 0x4000;
                rendering |= (job.Status & (spooling | printing | renderingLocally)) != 0;
                if ((job.Status & printing) == 0) continue;
                string? name = Marshal.PtrToStringUni(job.Document);
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (result != null) ambiguous = true;
                result = name;
            }
            return (rendering, ambiguous ? null : result);
        }
        finally
        {
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
            ClosePrinter(printer);
        }
    }
}
