namespace PdfEditor.Preview;

public static class WindowSizePolicy
{
    public const double MinimumWidth = 1000;
    public const double MinimumHeight = 680;

    public static (int Width, int Height) MinimumTrackSize(uint dpi, int workWidth, int workHeight)
    {
        double scale = (dpi == 0 ? 96 : dpi) / 96d;
        int width = (int)Math.Ceiling(MinimumWidth * scale);
        int height = (int)Math.Ceiling(MinimumHeight * scale);
        return (workWidth > 0 ? Math.Min(width, workWidth) : width,
                workHeight > 0 ? Math.Min(height, workHeight) : height);
    }
}
