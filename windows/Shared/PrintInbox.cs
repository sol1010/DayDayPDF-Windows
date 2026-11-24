using System.IO;
using System.Security.Principal;

namespace DaydayPDF.Printing;

public static class PrintInbox
{
    public static string UserKey => WindowsIdentity.GetCurrent().User!.Value;
    public static string PipeName => "DaydayPDF.Print." + UserKey;
    public static string PortName => @"\\.\pipe\" + PipeName;
    public static string Root => Path.Combine(Path.GetTempPath(), "DaydayPDF", "PrintedDocuments");
    public static string LegacyRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DaydayPDF", "PrintedDocuments");
    public static bool IsDaydayPrinter(string name, string? driver, string? port, string? comment) =>
        name.Equals("DaydayPDF", StringComparison.OrdinalIgnoreCase) &&
        ((driver == "MS Publisher Color Printer" && port == "NUL:" &&
          (comment == "DaydayPDF installed printer - unified EMF" || HasQueueMarker())) ||
         (driver == "Microsoft Print To PDF" && comment == "DaydayPDF installed printer - Microsoft Print To PDF"));

    private static bool HasQueueMarker()
    {
        const string key = @"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Print\Printers\DaydayPDF\PrinterDriverData";
        try { return Equals(Microsoft.Win32.Registry.GetValue(key, "DaydayPDF.QueueOwner", null), 1); }
        catch (UnauthorizedAccessException) { return false; }
        catch (System.Security.SecurityException) { return false; }
        catch (IOException) { return false; }
    }

    public static string NewPath(string? suggestedName = null)
    {
        if (!HasSafeDirectory()) throw new IOException("인쇄 문서 폴더가 연결된 경로입니다.");
        Directory.CreateDirectory(Root);
        if (!HasSafeDirectory()) throw new IOException("인쇄 문서 폴더가 연결된 경로입니다.");
        string name = Path.GetFileNameWithoutExtension(suggestedName ?? "인쇄 문서");
        name = string.Concat(name.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
        if (string.IsNullOrWhiteSpace(name)) name = "인쇄 문서";
        if (name.Length > 80) name = name[..(char.IsHighSurrogate(name[79]) ? 79 : 80)];
        return Path.Combine(Root, $"{name}_{DateTime.Now:yyyyMMdd_HHmmss}_{Guid.NewGuid():N}.pdf");
    }

    public static bool Contains(string? path)
    {
        if (!IsDirectChild(path, Root) || !Path.GetExtension(path!).Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return false;
        string name = Path.GetFileNameWithoutExtension(path)!;
        return name.Length > 49 && name[^49] == '_' && name[^33] == '_' &&
            Guid.TryParseExact(name[^32..], "N", out _) &&
            DateTime.TryParseExact(name.Substring(name.Length - 48, 15), "yyyyMMdd_HHmmss",
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out _);
    }

    public static bool IsLegacyPrint(string? path) => IsDirectChild(path, LegacyRoot);

    public static string DisplayName(string path) => Contains(path)
        ? Path.GetFileNameWithoutExtension(path)[..^49] + ".pdf"
        : Path.GetFileName(path);

    public static bool TryDelete(string? path)
    {
        if (!Contains(path)) return false;
        try
        {
            if (!File.Exists(path)) return true;
            if (!HasSafeDirectory() || File.GetAttributes(path!).HasFlag(FileAttributes.ReparsePoint)) return false;
            File.Delete(path!);
            return true;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private static bool IsDirectChild(string? path, string root)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)) return false;
        try { return string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)), Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase); }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
    }

    private static bool HasSafeDirectory()
    {
        for (DirectoryInfo? directory = new(Root); directory is not null; directory = directory.Parent)
            if (directory.Exists && directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) return false;
        return true;
    }
}
