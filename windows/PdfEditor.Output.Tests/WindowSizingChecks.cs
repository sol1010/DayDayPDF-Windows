using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using PdfEditor.Preview;

internal static class WindowSizingChecks
{
    internal static void Run()
    {
        var cases = new (uint Dpi, int WorkWidth, int WorkHeight, int Width, int Height)[] {
            (96, 1920, 1040, 1000, 680), (120, 1920, 1040, 1250, 850),
            (144, 1920, 1040, 1500, 1020), (192, 3840, 2080, 2000, 1360),
            (120, 1366, 728, 1250, 728), (192, 1920, 1040, 1920, 1040),
            (96, 800, 560, 800, 560), (0, 0, 0, 1000, 680),
            (110, 1920, 1040, 1146, 780), (96, 0, 600, 1000, 600)
        };
        foreach (var c in cases)
            if (WindowSizePolicy.MinimumTrackSize(c.Dpi, c.WorkWidth, c.WorkHeight) != (c.Width, c.Height))
                throw new Exception($"Wrong minimum at DPI {c.Dpi}, work area {c.WorkWidth}x{c.WorkHeight}");

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var window = new MainWindow { ShowInTaskbar = false };
        try
        {
            IntPtr hwnd = new WindowInteropHelper(window).EnsureHandle();
            uint dpi = GetDpiForWindow(hwnd);
            var monitor = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref monitor)) throw new Exception("No monitor work area");
            int workWidth = monitor.Work.Right - monitor.Work.Left, workHeight = monitor.Work.Bottom - monitor.Work.Top;
            var expected = WindowSizePolicy.MinimumTrackSize(dpi, workWidth, workHeight);
            IntPtr buffer = Marshal.AllocHGlobal(Marshal.SizeOf<MinMaxInfo>());
            try
            {
                for (int i = 0; i < 3; i++)
                {
                    Marshal.StructureToPtr(new MinMaxInfo(), buffer, false);
                    SendMessage(hwnd, 0x0024, IntPtr.Zero, buffer);
                    var actual = Marshal.PtrToStructure<MinMaxInfo>(buffer);
                    if ((actual.MinTrack.X, actual.MinTrack.Y) != expected) throw new Exception("Native resize minimum was not applied");
                    if ((actual.MaxSize.X, actual.MaxSize.Y) != (workWidth, workHeight)) throw new Exception("Maximize no longer respects taskbar work area");
                    double scale = (dpi == 0 ? 96 : dpi) / 96d;
                    if (window.MinWidth != expected.Width / scale || window.MinHeight != expected.Height / scale)
                        throw new Exception("WPF and native minimum sizes differ");
                }
                Console.WriteLine($"PASS native minimum: {expected.Width}x{expected.Height} px, DPI {dpi}; work area {workWidth}x{workHeight}");
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { window.Close(); app.Shutdown(); }
        Console.WriteLine($"PASS window sizing: {cases.Length} DPI/work-area cases and 3 native resize queries");
    }

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrack, MaxTrack; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
}
