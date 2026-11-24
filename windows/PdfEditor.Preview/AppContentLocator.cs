using System.Diagnostics;
using System.IO;

namespace PdfEditor.Preview;

internal static class AppContentLocator
{
    private static readonly Lazy<string> WebRootValue = new(ResolveWebRoot);

    public static string WebRoot => WebRootValue.Value;

    private static string ResolveWebRoot()
    {
        foreach (string candidate in CandidateRoots().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            string webRoot = Path.Combine(candidate, "WebApp");
            if (File.Exists(Path.Combine(webRoot, "view.html"))) return webRoot;
        }

        throw new FileNotFoundException(
            "Windows 단일 문서 뷰를 찾지 못했습니다. 단일 EXE 내부 파일 추출이 차단되었는지 확인해 주세요.");
    }

    private static IEnumerable<string> CandidateRoots()
    {
        yield return AppContext.BaseDirectory;

        if (AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") is string searchDirectories)
        {
            foreach (string directory in searchDirectories.Split(
                Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (Directory.Exists(directory)) yield return directory;
            }
        }

        ProcessModuleCollection? modules = null;
        try { modules = Process.GetCurrentProcess().Modules; }
        catch { }
        if (modules is null) yield break;
        foreach (ProcessModule module in modules)
        {
            string? directory = null;
            try
            {
                if (module.ModuleName.Equals("coreclr.dll", StringComparison.OrdinalIgnoreCase))
                    directory = Path.GetDirectoryName(module.FileName);
            }
            catch { }
            if (!string.IsNullOrWhiteSpace(directory)) yield return directory;
        }
    }
}
