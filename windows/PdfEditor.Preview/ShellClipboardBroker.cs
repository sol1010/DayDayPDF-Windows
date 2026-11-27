using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace PdfEditor.Preview;

internal static class ShellClipboardBroker
{
    private const ulong MaximumClipboardBytes = 1024UL * 1024 * 1024;
    private static readonly Dictionary<string, PendingPut> Pending = new();
    private static StoredClipboard? _current;

    public static bool BeginPut(
        CoreWebView2Environment environment,
        TabSession session,
        string requestId,
        ulong size,
        JsonElement metadata)
    {
        if (size == 0 || size > MaximumClipboardBytes || string.IsNullOrWhiteSpace(requestId))
            return false;

        RemovePending(requestId);
        CoreWebView2SharedBuffer buffer = environment.CreateSharedBuffer(size);
        Pending[requestId] = new PendingPut(session, buffer, metadata.Clone());
        try
        {
            session.WebView?.PostSharedBufferToScript(
                buffer,
                CoreWebView2SharedBufferAccess.ReadWrite,
                JsonSerializer.Serialize(new
                {
                    cmd = "clipboard-put-buffer",
                    requestId,
                    size
                }));
        }
        catch
        {
            RemovePending(requestId);
            throw;
        }
        return true;
    }

    public static void CancelPut(TabSession session, string requestId)
    {
        if (Pending.TryGetValue(requestId, out var pending) && pending.Session == session)
            RemovePending(requestId);
    }

    public static bool CommitPut(TabSession session, string requestId)
    {
        if (!Pending.Remove(requestId, out PendingPut? pending) || pending.Session != session)
            return false;

        _current?.Buffer.Close();
        _current = new StoredClipboard(
            pending.Buffer,
            pending.Metadata,
            Stopwatch.GetTimestamp(),
            GetClipboardSequenceNumber());
        session.WebView?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            cmd = "clipboard-put-committed",
            requestId,
            timestamp = _current.Timestamp
        }));
        return true;
    }

    public static bool SendCurrent(TabSession target, string requestId, bool metadataOnly = false)
    {
        StoredClipboard? current = _current;
        if (current is null)
        {
            SendUnavailable(target, requestId, false);
            return false;
        }

        uint sequence = GetClipboardSequenceNumber();
        if (current.SystemClipboardSequence != 0 && sequence != current.SystemClipboardSequence)
        {
            SendUnavailable(target, requestId, true);
            return false;
        }

        if (metadataOnly)
        {
            target.WebView?.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                cmd = "clipboard-state",
                requestId,
                meta = current.Metadata
            }));
            return true;
        }

        target.WebView?.PostSharedBufferToScript(
            current.Buffer,
            CoreWebView2SharedBufferAccess.ReadOnly,
            JsonSerializer.Serialize(new
            {
                cmd = "clipboard-data",
                requestId,
                timestamp = current.Timestamp,
                meta = current.Metadata
            }));
        return true;
    }

    public static void RemovePendingFor(TabSession session)
    {
        foreach (string requestId in Pending
            .Where(pair => pair.Value.Session == session)
            .Select(pair => pair.Key)
            .ToArray())
        {
            RemovePending(requestId);
        }
    }

    private static void SendUnavailable(TabSession target, string requestId, bool systemNewer) =>
        target.WebView?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            cmd = "clipboard-data-unavailable",
            requestId,
            systemNewer
        }));

    private static void RemovePending(string requestId)
    {
        if (!Pending.Remove(requestId, out PendingPut? pending)) return;
        pending.Buffer.Close();
    }

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    private sealed record PendingPut(
        TabSession Session,
        CoreWebView2SharedBuffer Buffer,
        JsonElement Metadata);

    private sealed record StoredClipboard(
        CoreWebView2SharedBuffer Buffer,
        JsonElement Metadata,
        long Timestamp,
        uint SystemClipboardSequence);
}
