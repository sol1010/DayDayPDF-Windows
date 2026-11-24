using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.IO;
using PdfEditor.Preview;

internal static class UpdateFeedChecks
{
    private sealed class Replies(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        { token.ThrowIfCancellationRequested(); return Task.FromResult(reply(request)); }
    }

    internal static async Task Run()
    {
        var current = new Version(26, 11, 24, 2);
        var next = new Version(26, 11, 24, 3);
        var tag = "v" + next;
        byte[] content = Encoding.UTF8.GetBytes("DayDayPDF update test");
        string digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
        string url = $"{GitHubReleaseFeed.Repository}/releases/download/{tag}/DayDayPDF.Setup.exe";
        string json = "";
        var target = new Uri("https://release-assets.githubusercontent.com/test");
        using var http = new HttpClient(new Replies(request => {
            if (request.RequestUri!.Host == "api.github.com") return new(HttpStatusCode.OK) { Content = new StringContent(json) };
            if (request.RequestUri.AbsoluteUri == url) return new(HttpStatusCode.Found) { Headers = { Location = target } };
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(content) };
        }));
        var feed = new GitHubReleaseFeed(http);
        string Metadata(bool draft = false, bool prerelease = false, string? hash = null) => JsonSerializer.Serialize(new {
            tag_name = tag, draft, prerelease, assets = new[] { new { name = "DayDayPDF.Setup.exe", state = "uploaded",
                size = content.Length, browser_download_url = url, digest = "sha256:" + (hash ?? digest) } } });
        json = Metadata();
        var release = await feed.LatestAsync(current, default) ?? throw new Exception("Update missing");
        using var output = new MemoryStream();
        await feed.DownloadAsync(release, output, default);
        if (!output.ToArray().SequenceEqual(content) || release.Version != next) throw new Exception("Unexpected payload");
        if (await feed.LatestAsync(next, default) != null || await feed.LatestAsync(new Version(30,0,0,0), default) != null)
            throw new Exception("Downgrade offered");
        foreach (var flags in new[] { (true, false), (false, true) }) {
            json = Metadata(flags.Item1, flags.Item2);
            if (await feed.LatestAsync(current, default) != null) throw new Exception("Unpublished version offered");
        }
        async Task Reject(Func<Task> check) { try { await check(); } catch (InvalidDataException) { return; } throw new Exception("Invalid update accepted"); }
        json = Metadata(hash: "bad");
        await Reject(() => feed.LatestAsync(current, default));
        await Reject(() => feed.DownloadAsync(release with { Digest = new string('0', 64) }, Stream.Null, default));
        await Reject(() => feed.DownloadAsync(release with { Size = content.Length + 1 }, Stream.Null, default));
        target = new Uri("https://example.org/file");
        await Reject(() => feed.DownloadAsync(release, Stream.Null, default));
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        try { await feed.DownloadAsync(release, Stream.Null, canceled.Token); throw new Exception("Cancellation ignored"); }
        catch (OperationCanceledException) { }
        Console.WriteLine("PASS stable feed, version, redirect, digest, length and cancellation");
    }

    internal static async Task VerifyPublic(Version expected)
    {
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DayDayPDF-release-check");
        var feed = new GitHubReleaseFeed(http);
        var release = await feed.LatestAsync(new Version(0,0,0,0), default);
        if (release?.Version != expected) throw new Exception("Unexpected public release");
        await feed.DownloadAsync(release, Stream.Null, default);
        Console.WriteLine($"Verified public stable v{release.Version} ({release.Size} bytes)");
    }
}
