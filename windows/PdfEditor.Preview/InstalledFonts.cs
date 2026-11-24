using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace PdfEditor.Preview;

internal sealed class InstalledFonts
{
    private readonly List<string> files = new();
    private readonly byte[] catalog;
    private static readonly Lazy<Task<InstalledFonts>> Current = new(() => Task.Run(() => new InstalledFonts()));
    private const string FontHost = "pc-fonts.daydaypdf.invalid";
    private const string Prefix = "/_pcfonts/";

    private InstalledFonts()
    {
        var faces = new List<object>();
        var ids = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var family in Fonts.SystemFontFamilies)
        foreach (var typeface in family.GetTypefaces())
        {
            try
            {
                if (!typeface.TryGetGlyphTypeface(out var glyph) || !glyph.FontUri.IsFile ||
                    glyph.StyleSimulations != StyleSimulations.None) continue;
                var path = glyph.FontUri.LocalPath;
                if (!ids.TryGetValue(path, out var id))
                {
                    id = files.Count;
                    ids.Add(path, id);
                    files.Add(path);
                }
                int.TryParse(glyph.FontUri.Fragment.TrimStart('#'), out var index);
                var aliases = family.FamilyNames.Values.Concat(glyph.FamilyNames?.Values ?? Array.Empty<string>())
                    .Concat(glyph.Win32FamilyNames?.Values ?? Array.Empty<string>()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                var english = CultureInfo.GetCultureInfo("en-US");
                string name = glyph.FamilyNames?.TryGetValue(english, out var en) == true ? en : family.Source;
                string label = glyph.FamilyNames?.TryGetValue(CultureInfo.CurrentUICulture, out var local) == true ? local : name;
                faces.Add(new { id, index, name, label, aliases, weight = glyph.Weight.ToOpenTypeWeight(),
                    italic = glyph.Style != System.Windows.FontStyles.Normal, stretch = glyph.Stretch.ToOpenTypeStretch(),
                    ko = glyph.CharacterToGlyphMap.ContainsKey(0xAC00), rights = glyph.EmbeddingRights.ToString() });
            }
            catch (Exception error) when (error is IOException or ArgumentException or NotSupportedException or UnauthorizedAccessException)
            { /* One unreadable font must not hide the rest of the collection. */ }
        }
        catalog = JsonSerializer.SerializeToUtf8Bytes(faces);
    }

    internal static void Warmup() => _ = Current.Value;

    internal static void Attach(CoreWebView2 core, string host)
    {
        core.AddWebResourceRequestedFilter($"https://{FontHost}{Prefix}*", CoreWebView2WebResourceContext.All,
            CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += async (_, e) =>
        {
            var request = e.Request;
            var uri = new Uri(request.Uri);
            if (uri.Scheme != "https" || !uri.IsDefaultPort || uri.Host != FontHost || !uri.AbsolutePath.StartsWith(Prefix, StringComparison.Ordinal)) return;
            var deferral = e.GetDeferral();
            var status = 404;
            Stream? body = null;
            var mime = "application/octet-stream";
            try
            {
                if (request.Method == "GET" && request.Headers.Contains("Origin") &&
                    request.Headers.GetHeader("Origin") == $"https://{host}")
                {
                    var fonts = await Current.Value;
                    var key = uri.AbsolutePath[Prefix.Length..];
                    if (key == "catalog")
                    {
                        mime = "application/json";
                        body = new MemoryStream(fonts.catalog, writable: false);
                    }
                    else if (int.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out int id) &&
                             (uint)id < (uint)fonts.files.Count)
                        body = File.OpenRead(fonts.files[id]);
                    if (body != null) status = 200;
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            { status = 404; }
            finally
            {
                e.Response = core.Environment.CreateWebResourceResponse(body, status, status == 200 ? "OK" : "Not Found",
                    $"Content-Type: {mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nVary: Origin\r\nAccess-Control-Allow-Origin: https://{host}");
                deferral.Complete();
            }
        };
    }
}
