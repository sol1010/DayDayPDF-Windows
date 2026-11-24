using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace PdfEditor.Preview;

internal static class EditorColorSampler
{
    public static async Task PostFrameAsync(CoreWebView2Environment environment, CoreWebView2 web, string requestId)
    {
        string source = web.Source;
        using var image = new MemoryStream();
        await web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
        if (web.Source != source) return;
        using var buffer = environment.CreateSharedBuffer((ulong)image.Length);
        image.Position = 0;
        using (var destination = buffer.OpenStream()) image.CopyTo(destination);
        web.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadOnly,
            JsonSerializer.Serialize(new { cmd = "color-sample-frame", requestId }));
    }
}
