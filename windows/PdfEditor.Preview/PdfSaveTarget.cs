using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PdfEditor.Preview;

internal static class PdfSaveTarget
{
    private const uint DeleteAccess = 0x10000;
    private const uint AddFile = 2;
    private const uint BackupSemantics = 0x02000000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, FileShare share,
        IntPtr security, FileMode mode, uint flags, IntPtr template);

    private static SafeFileHandle Open(string path, uint access, uint flags = 0) =>
        CreateFileW(Path.GetFullPath(path), access, FileShare.ReadWrite | FileShare.Delete,
            IntPtr.Zero, FileMode.Open, flags, IntPtr.Zero);

    public static bool CanReplace(string path)
    {
        try
        {
            string? folder = Path.GetDirectoryName(Path.GetFullPath(path));
            if (folder is null) return false;
            using var directory = Open(folder, AddFile, BackupSemantics);
            if (directory.IsInvalid) return false;
            if ((File.GetAttributes(path) & (FileAttributes.ReadOnly | FileAttributes.Directory)) != 0)
                return false;
            using var file = Open(path, DeleteAccess);
            return !file.IsInvalid;
        }
        catch (FileNotFoundException) { return true; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
    }
}
