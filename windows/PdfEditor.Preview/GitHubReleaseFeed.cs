using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;

namespace PdfEditor.Preview;

internal sealed record WindowsRelease(Version Version, Uri Installer, long Size, string Digest);

internal sealed class GitHubReleaseFeed(HttpClient http)
{
    internal const string Repository = "https://github.com/sol1010/DayDayPDF-Windows";
    private const string Latest = "https://api.github.com/repos/sol1010/DayDayPDF-Windows/releases/latest";
    private const long MaxBytes = 512L * 1024 * 1024;

    internal async Task<WindowsRelease?> LatestAsync(Version installed, CancellationToken token)
    {
        using var response = await http.GetAsync(Latest, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        await response.Content.LoadIntoBufferAsync(1024 * 1024, token).ConfigureAwait(false);
        using var json = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(token).ConfigureAwait(false));
        var root = json.RootElement;
        if (root.GetProperty("draft").GetBoolean() || root.GetProperty("prerelease").GetBoolean()) return null;
        string? tag = root.GetProperty("tag_name").GetString();
        if (tag is null || !tag.StartsWith('v') || !Version.TryParse(tag[1..], out var version) ||
            version.Revision < 0 || tag != "v" + version) throw new InvalidDataException();
        if (version <= installed) return null;
        var url = new Uri($"{Repository}/releases/download/{tag}/DayDayPDF.Setup.exe");
        var asset = root.GetProperty("assets").EnumerateArray().Single(a => a.GetProperty("name").GetString() == "DayDayPDF.Setup.exe");
        long size = asset.GetProperty("size").GetInt64();
        string digest = asset.GetProperty("digest").GetString() ?? "";
        if (asset.GetProperty("state").GetString() != "uploaded" || asset.GetProperty("browser_download_url").GetString() != url.AbsoluteUri ||
            size is <= 0 or > MaxBytes || digest.Length != 71 || !digest.StartsWith("sha256:", StringComparison.Ordinal) ||
            !digest[7..].All(Uri.IsHexDigit)) throw new InvalidDataException();
        return new(version, url, size, digest[7..]);
    }

    internal async Task DownloadAsync(WindowsRelease release, Stream output, CancellationToken token)
    {
        var uri = release.Installer;
        for (int i = 0; i < 5; i++)
        {
            using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } redirect)
            {
                uri = new Uri(uri, redirect);
                if (uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 ||
                    uri.Host is not ("github.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
                    throw new InvalidDataException();
                continue;
            }
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is long length && length != release.Size) throw new InvalidDataException();
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            using var source = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
            byte[] buffer = new byte[128 * 1024];
            long total = 0;
            int count;
            while ((count = await source.ReadAsync(buffer, token).ConfigureAwait(false)) > 0)
            {
                total += count;
                if (total > release.Size) throw new InvalidDataException();
                hash.AppendData(buffer, 0, count);
                await output.WriteAsync(buffer.AsMemory(0, count), token).ConfigureAwait(false);
            }
            if (total != release.Size || !Convert.ToHexString(hash.GetHashAndReset()).Equals(release.Digest, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException();
            return;
        }
        throw new InvalidDataException();
    }
}
