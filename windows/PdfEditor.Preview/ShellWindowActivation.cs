using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Win32.SafeHandles;

namespace PdfEditor.Preview;

internal static class ShellWindowActivation
{
    internal static bool GrantToPipeServer(SafePipeHandle pipe, out uint processId) =>
        GetNamedPipeServerProcessId(pipe, out processId) &&
        AllowSetForegroundWindow(processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(uint processId);

    internal static bool ActivateFromLauncher(uint server, IntPtr handle)
    {
        if (server == 0 || GetWindowThreadProcessId(handle, out uint owner) == 0 || owner != server) return false;
        IntPtr target = ActivationTarget(handle);
        return GetForegroundWindow() == target || SetForegroundWindow(target);
    }

    private static IntPtr ActivationTarget(IntPtr handle)
    {
        IntPtr popup = GetLastActivePopup(handle);
        return !IsWindowEnabled(handle) && IsWindowVisible(popup) ? popup : handle;
    }

    internal static bool BringToFront(Window window)
    {
        if (!window.IsVisible) window.Show();
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero) return false;
        if (IsIconic(handle)) ShowWindow(handle, 9); // SW_RESTORE preserves maximized state.
        IntPtr target = ActivationTarget(handle);
        if (GetForegroundWindow() == target || SetForegroundWindow(target)) return true;
        const uint keepSizePositionAndFocus = 0x0001 | 0x0002 | 0x0010 | 0x0200;
        const int extendedStyle = -20, topmost = 0x0008;
        if ((GetWindowLong(target, extendedStyle) & topmost) == 0 &&
            SetWindowPos(target, new IntPtr(-1), 0, 0, 0, 0, keepSizePositionAndFocus))
            SetWindowPos(target, new IntPtr(-2), 0, 0, 0, 0, keepSizePositionAndFocus);
        else
            SetWindowPos(target, IntPtr.Zero, 0, 0, 0, 0, keepSizePositionAndFocus);
        return GetForegroundWindow() == target;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetLastActivePopup(IntPtr window);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);
}
