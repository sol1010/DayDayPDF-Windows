using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace DaydayPDF.PrintReceiver;

internal static class ReplayDefaultPrinter
{
    [DllImport("winspool.drv", CharSet = CharSet.Unicode)]
    private static extern bool GetDefaultPrinter(StringBuilder? name, ref int count);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode)]
    private static extern bool SetDefaultPrinter(string name);

    private static bool ManagedByWindows()
    {
        try
        {
            return Equals(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows NT\CurrentVersion\Windows", "LegacyDefaultPrinterMode", 0), 0);
        }
        catch (UnauthorizedAccessException) { return false; }
        catch (System.Security.SecurityException) { return false; }
        catch (IOException) { return false; }
    }

    private static string? Current()
    {
        int count = 0;
        GetDefaultPrinter(null, ref count);
        if (count is < 2 or > 32768) return null;
        var name = new StringBuilder(count);
        return GetDefaultPrinter(name, ref count) ? name.ToString() : null;
    }

    internal static string? Capture(string internalPrinter)
    {
        if (!ManagedByWindows()) return null;
        string? current = Current();
        return string.Equals(current, internalPrinter, StringComparison.OrdinalIgnoreCase) ? null : current;
    }

    internal static void Restore(string? previous, string internalPrinter)
    {
        if (previous is not null && ManagedByWindows() &&
            string.Equals(Current(), internalPrinter, StringComparison.OrdinalIgnoreCase))
            SetDefaultPrinter(previous);
    }
}
