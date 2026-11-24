using Microsoft.Web.WebView2.Core;
using System.IO;

namespace PdfEditor.Preview;

internal static class BrowserRuntime
{
    private static readonly object Sync = new();
    private static Task<CoreWebView2Environment>? _environmentTask;

    public static Task<CoreWebView2Environment> GetEnvironmentAsync()
    {
        lock (Sync)
        {
            return _environmentTask ??= CreateEnvironmentAsync();
        }
    }

    private static Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        string userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SolPdfEditor",
            "Preview",
            "WebView2");
        return CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataFolder);
    }
}
