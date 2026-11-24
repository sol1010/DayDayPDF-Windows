using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace PdfEditor.Preview;

internal sealed record DesktopRecoveryTab(
    Guid Id,
    string Title,
    string? DocPath,
    bool Active);

internal static class DesktopRecoveryStore
{
    private const int SchemaVersion = 1;
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };
    private static bool? _enabled;

    public static string DataFolder { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SolPdfEditor",
        "Preview");

    private static string ManifestPath => Path.Combine(DataFolder, "recovery-session.json");

    public static bool Enabled
    {
        get
        {
            lock (Sync)
            {
                _enabled ??= ReadManifest()?.Enabled ?? true;
                return _enabled.Value;
            }
        }
    }

    public static IReadOnlyList<DesktopRecoveryTab> LoadTabs()
    {
        lock (Sync)
        {
            RecoveryManifest? manifest = ReadManifest();
            _enabled = manifest?.Enabled ?? true;
            if (!_enabled.Value || manifest?.Version != SchemaVersion) return Array.Empty<DesktopRecoveryTab>();
            return manifest.Tabs
                .Where(tab => tab.Id != Guid.Empty)
                .GroupBy(tab => tab.Id)
                .Select(group => group.First())
                .ToArray();
        }
    }

    public static void SaveTabs(IEnumerable<DesktopRecoveryTab> tabs)
    {
        lock (Sync)
        {
            _enabled ??= ReadManifest()?.Enabled ?? true;
            if (!_enabled.Value) return;
            WriteManifest(new RecoveryManifest(
                SchemaVersion,
                true,
                tabs.Where(tab => tab.Id != Guid.Empty).ToArray()));
        }
    }

    public static void SetEnabled(bool enabled)
    {
        lock (Sync)
        {
            _enabled = enabled;
            RecoveryManifest current = ReadManifest() ??
                new RecoveryManifest(SchemaVersion, enabled, Array.Empty<DesktopRecoveryTab>());
            WriteManifest(current with
            {
                Version = SchemaVersion,
                Enabled = enabled,
                Tabs = enabled ? current.Tabs : Array.Empty<DesktopRecoveryTab>()
            });
        }
    }

    public static void OpenFolder()
    {
        Directory.CreateDirectory(DataFolder);
        Process.Start(new ProcessStartInfo(DataFolder) { UseShellExecute = true });
    }

    private static RecoveryManifest? ReadManifest()
    {
        try
        {
            if (!File.Exists(ManifestPath)) return null;
            return JsonSerializer.Deserialize<RecoveryManifest>(File.ReadAllText(ManifestPath), JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private static void WriteManifest(RecoveryManifest manifest)
    {
        Directory.CreateDirectory(DataFolder);
        string temporaryPath = ManifestPath + ".tmp";
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(manifest, JsonOptions));
            File.Move(temporaryPath, ManifestPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
        }
    }

    private sealed record RecoveryManifest(
        int Version,
        bool Enabled,
        IReadOnlyList<DesktopRecoveryTab> Tabs);
}
