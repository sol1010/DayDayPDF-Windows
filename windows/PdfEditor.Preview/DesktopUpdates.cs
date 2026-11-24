using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Windows.Threading;
using Microsoft.Win32;

namespace PdfEditor.Preview;

internal sealed class DesktopUpdates
{
    private const string Key = @"HKEY_CURRENT_USER\Software\DaydayPDF\Updates";
    private static readonly string Local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string Cache = Path.Combine(Local, "DaydayPDF", "Updates");
    private static readonly string Setup = Path.Combine(Cache, "DayDayPDF.Setup.exe");
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromMinutes(20) };
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromHours(12) };
    private readonly Version _installed = typeof(DesktopUpdates).Assembly.GetName().Version!;
    private CancellationTokenSource? _check;
    private WindowsRelease? _ready;
    private string _status = "off";
    internal event Action? Changed;
    internal bool Enabled { get; private set; }
    internal bool Available { get; } = string.Equals(Environment.ProcessPath,
        Path.Combine(Local, "Programs", "DaydayPDF", "DaydayPDF.exe"), StringComparison.OrdinalIgnoreCase);
    internal object Snapshot => new { cmd = "update-state", enabled = Enabled, available = Available, status = _status, version = _ready?.Version.ToString() };

    internal void Start()
    {
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("DayDayPDF-Windows/" + _installed);
        _timer.Tick += (_, _) => Check();
        Enabled = Available && Equals(Registry.GetValue(Key, "Automatic", 0), 1);
        if (Enabled) { _timer.Start(); Check(); }
        else if (Available) Discard();
    }

    internal void SetEnabled(bool enabled)
    {
        if (!Available || Enabled == enabled) return;
        Registry.SetValue(Key, "Automatic", enabled ? 1 : 0, RegistryValueKind.DWord);
        Enabled = enabled;
        if (enabled) { _timer.Start(); Check(); }
        else
        {
            _timer.Stop();
            _check?.Cancel();
            _check = null;
            _ready = null;
            Discard();
            SetStatus("off");
        }
    }

    private static void Discard()
    {
        try { File.Delete(Setup); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private void SetStatus(string status) { _status = status; Changed?.Invoke(); }

    internal void Check()
    {
        if (Enabled && _check is null) _ = CheckAsync();
    }

    private async Task CheckAsync()
    {
        using var check = new CancellationTokenSource(TimeSpan.FromMinutes(20));
        _check = check;
        string? temp = null;
        try
        {
            SetStatus("checking");
            var feed = new GitHubReleaseFeed(_http);
            var release = await feed.LatestAsync(_installed, check.Token);
            check.Token.ThrowIfCancellationRequested();
            if (release is null) { _ready = null; Discard(); SetStatus("current"); return; }
            if (_ready == release && File.Exists(Setup)) { SetStatus("ready"); return; }
            _ready = null;
            SetStatus("downloading");
            Directory.CreateDirectory(Cache);
            foreach (var partial in Directory.EnumerateFiles(Cache, "*.partial"))
            {
                if (Guid.TryParseExact(Path.GetFileNameWithoutExtension(partial), "N", out _) &&
                    File.GetLastWriteTimeUtc(partial) < DateTime.UtcNow.AddDays(-1))
                    try { File.Delete(partial); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
            if (File.Exists(Setup) && new FileInfo(Setup).Length == release.Size)
            {
                using var previous = File.OpenRead(Setup);
                var digest = await SHA256.HashDataAsync(previous, check.Token);
                check.Token.ThrowIfCancellationRequested();
                if (Convert.ToHexString(digest).Equals(release.Digest, StringComparison.OrdinalIgnoreCase) &&
                    Version.TryParse(FileVersionInfo.GetVersionInfo(Setup).FileVersion, out var version) && version == release.Version)
                {
                    _ready = release;
                    SetStatus("ready");
                    return;
                }
            }
            temp = Path.Combine(Cache, Guid.NewGuid().ToString("N") + ".partial");
            await using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
                await feed.DownloadAsync(release, file, check.Token);
            check.Token.ThrowIfCancellationRequested();
            if (!Version.TryParse(FileVersionInfo.GetVersionInfo(temp).FileVersion, out var embedded) || embedded != release.Version)
                throw new InvalidDataException();
            File.Move(temp, Setup, true);
            _ready = release;
            SetStatus("ready");
        }
        catch (Exception) when (_check != check || !Enabled) { }
        catch (Exception) { SetStatus(_ready is null ? "failed" : "ready"); }
        finally
        {
            if (temp is not null) try { File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            if (_check == check) _check = null;
        }
    }

    internal void Exit(bool normal)
    {
        _timer.Stop();
        _check?.Cancel();
        if (!normal || !Enabled || _ready is not { } release) return;
        try
        {
            using var file = File.Open(Setup, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (!Convert.ToHexString(SHA256.HashData(file)).Equals(release.Digest, StringComparison.OrdinalIgnoreCase)) return;
            var start = new ProcessStartInfo(Setup) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("--apply-after-exit");
            start.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Process.Start(start)?.Dispose();
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }
}
