using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace DaydayPDF.PrintReceiver;

internal sealed class WindowsPdfReplay : IDisposable
{
    private const string Driver = "Microsoft Print To PDF";
    private readonly string printer;
    private readonly string path;
    private readonly string title;
    private IntPtr dc;
    private bool active;
    private readonly SpoolFonts fonts = new();
    private byte[]? lastMode;
    private int[] sourceCaps = [];

    [StructLayout(LayoutKind.Sequential)]
    private struct QueueInfo
    {
        public IntPtr Server, Name, Share, Port, Driver, Comment, Location, Mode, Separator, Processor, Type, Parameters, Security;
        public uint Attributes, Priority, DefaultPriority, Start, Until, Status, Jobs, PagesPerMinute;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo
    {
        public int Size;
        public string Name, Output;
        public IntPtr DataType;
        public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr buffer, uint bytes, out uint needed, out uint count);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv")] private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int DocumentProperties(IntPtr window, IntPtr printer, string name, IntPtr output, IntPtr input, int flags);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDC(string driver, string device, string? output, IntPtr mode);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr ResetDC(IntPtr dc, IntPtr mode);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern int StartDoc(IntPtr dc, ref DocInfo doc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int StartPage(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int EndPage(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int EndDoc(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern int AbortDoc(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern int GetDeviceCaps(IntPtr dc, int index);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr SetEnhMetaFileBits(uint size, byte[] data);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern bool PlayEnhMetaFile(IntPtr dc, IntPtr emf, ref Rect rect);
    [DllImport("gdi32.dll")] private static extern bool DeleteEnhMetaFile(IntPtr emf);

    internal WindowsPdfReplay(string output, string name)
    {
        path = output;
        title = name;
        EnumPrinters(2, null, 2, IntPtr.Zero, 0, out uint needed, out _);
        if (needed == 0 || needed > 16 * 1024 * 1024) throw new IOException("Windows PDF 프린터를 조회할 수 없습니다.");
        IntPtr buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrinters(2, null, 2, buffer, needed, out _, out uint count)) throw new Win32Exception();
            for (int i = 0; i < count; i++)
            {
                var q = Marshal.PtrToStructure<QueueInfo>(IntPtr.Add(buffer, i * Marshal.SizeOf<QueueInfo>()));
                if (!string.Equals(Marshal.PtrToStringUni(q.Driver), Driver, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(Marshal.PtrToStringUni(q.Port), "PORTPROMPT:", StringComparison.OrdinalIgnoreCase)) continue;
                printer = Marshal.PtrToStringUni(q.Name)!;
                return;
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
        throw new IOException("Windows의 Microsoft Print to PDF 프린터를 찾을 수 없습니다.");
    }

    private void SetPaper(byte[] source)
    {
        if (lastMode != null && source.AsSpan().SequenceEqual(lastMode)) return;
        sourceCaps = FastPrinter.DeviceCaps(source);
        if (!OpenPrinter(printer, out var handle, IntPtr.Zero)) throw new Win32Exception();
        IntPtr settings = IntPtr.Zero;
        try
        {
            int size = DocumentProperties(IntPtr.Zero, handle, printer, IntPtr.Zero, IntPtr.Zero, 0);
            if (size is < 166 or > 131072) throw new InvalidDataException("Windows PDF 용지 정보가 없습니다.");
            settings = Marshal.AllocHGlobal(size);
            if (DocumentProperties(IntPtr.Zero, handle, printer, settings, IntPtr.Zero, 2) != 1) throw new Win32Exception();
            int fields = BitConverter.ToInt32(source, 72);
            const int paperFields = 1 | 2 | 4 | 8;
            int nativeFields = Marshal.ReadInt32(settings, 72) & ~(paperFields | 0x10000);
            Marshal.WriteInt32(settings, 72, nativeFields | (fields & paperFields));
            if ((nativeFields & 0x10) != 0) Marshal.WriteInt16(settings, 84, 100);
            for (int offset = 76; offset <= 82; offset += 2)
                Marshal.WriteInt16(settings, offset, BitConverter.ToInt16(source, offset));
            if (DocumentProperties(IntPtr.Zero, handle, printer, settings, settings, 10) != 1) throw new Win32Exception();
            var next = dc == IntPtr.Zero ? CreateDC("WINSPOOL", printer, null, settings) : ResetDC(dc, settings);
            if (next == IntPtr.Zero) throw new Win32Exception();
            dc = next;
            for (int axis = 0; axis < 2; axis++)
            {
                double sourceMm = sourceCaps[4 + axis] * 25.4 / sourceCaps[2 + axis];
                double targetMm = GetDeviceCaps(dc, 110 + axis) * 25.4 / GetDeviceCaps(dc, 88 + 2 * axis);
                if (Math.Abs(sourceMm - targetMm) > 1) throw new InvalidDataException("Windows PDF가 선택한 용지 크기를 지원하지 않습니다.");
            }
            lastMode = source;
        }
        finally { Marshal.FreeHGlobal(settings); ClosePrinter(handle); }
    }

    private int Position(byte[] page, int frameOffset, int axis)
    {
        int pixels = BitConverter.ToInt32(page, 72 + 4 * axis), mm = BitConverter.ToInt32(page, 80 + 4 * axis);
        if (mm <= 0 || pixels <= 0) throw new InvalidDataException("페이지 기준 크기가 잘못되었습니다.");
        double offset = BitConverter.ToInt32(page, frameOffset) * (double)pixels / (100 * (double)mm);
        return checked((int)Math.Round((sourceCaps[6 + axis] + offset) * GetDeviceCaps(dc, 88 + 2 * axis) / sourceCaps[2 + axis]) - GetDeviceCaps(dc, 112 + axis));
    }

    internal void ReadFonts(Stream input, int length, byte[] mode, CancellationToken stop)
    {
        Span<byte> header = stackalloc byte[8];
        var buffer = System.Buffers.ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            for (int left = length; left > 0;)
            {
                stop.ThrowIfCancellationRequested();
                if (left < 8) throw new InvalidDataException();
                input.ReadExactly(header);
                int size = BitConverter.ToInt32(header[4..]);
                if (size < 8 || (size & 3) != 0 || size > left) throw new InvalidDataException();
                left -= size;
                if (BitConverter.ToInt32(header) == 70 && size >= 20)
                {
                    input.ReadExactly(buffer, 0, 12);
                    if (buffer.AsSpan(8, 4).SequenceEqual("FNOT"u8))
                    {
                        if (size > 32 * 1024 * 1024) throw new InvalidDataException();
                        var record = GC.AllocateUninitializedArray<byte>(size);
                        header.CopyTo(record);
                        buffer.AsSpan(0, 12).CopyTo(record.AsSpan(8));
                        input.ReadExactly(record, 20, size - 20);
                        fonts.Read(record);
                        continue;
                    }
                    size -= 12;
                }
                for (int remaining = size - 8; remaining > 0;)
                {
                    int count = Math.Min(remaining, buffer.Length);
                    input.ReadExactly(buffer, 0, count);
                    remaining -= count;
                }
            }
        }
        finally { System.Buffers.ArrayPool<byte>.Shared.Return(buffer); }
    }

    internal void Page(Stream input, int length, byte[] mode, CancellationToken stop)
    {
        if (input is not MemoryStream memory || !memory.TryGetBuffer(out var segment) ||
            segment.Offset != 0 || segment.Count != length) throw new InvalidDataException();
        byte[] page = segment.Array!;
        if (BitConverter.ToInt32(page) != 1 || BitConverter.ToInt32(page, 48) != length ||
            !page.AsSpan(40, 4).SequenceEqual(" EMF"u8)) throw new InvalidDataException("인쇄 페이지 형식이 잘못되었습니다.");
        int type = 0;
        for (int at = 0; at < length;)
        {
            stop.ThrowIfCancellationRequested();
            if (length - at < 8) throw new InvalidDataException();
            type = BitConverter.ToInt32(page, at);
            int size = BitConverter.ToInt32(page, at + 4);
            if (size < 8 || (size & 3) != 0 || size > length - at || (type == 14 && size != length - at)) throw new InvalidDataException();
            if (type is 105 or 106 or 110)
            {
                const int getTechnology = 20;
                if (type != 106 || size != 16 || BitConverter.ToInt32(page, at + 8) != getTechnology || BitConverter.ToInt32(page, at + 12) != 0)
                    throw new InvalidDataException("지원하지 않는 프린터 전용 명령이 포함된 작업입니다.");
            }
            at += size;
        }
        if (type != 14) throw new InvalidDataException("인쇄 페이지가 완성되지 않았습니다.");
        SetPaper(mode);
        if (!active)
        {
            fonts.Activate();
            var doc = new DocInfo { Size = Marshal.SizeOf<DocInfo>(), Name = title, Output = path };
            if (StartDoc(dc, ref doc) <= 0) throw new Win32Exception();
            active = true;
        }
        var frame = new Rect { Left = Position(page, 24, 0), Top = Position(page, 28, 1), Right = Position(page, 32, 0), Bottom = Position(page, 36, 1) };
        if (frame.Right <= frame.Left || frame.Bottom <= frame.Top) throw new InvalidDataException("인쇄 영역이 잘못되었습니다.");
        var emf = SetEnhMetaFileBits((uint)length, page);
        if (emf == IntPtr.Zero) throw new Win32Exception();
        try
        {
            if (StartPage(dc) <= 0 || !PlayEnhMetaFile(dc, emf, ref frame) || EndPage(dc) <= 0) throw new Win32Exception();
        }
        finally { DeleteEnhMetaFile(emf); }
    }

    internal void Finish(CancellationToken stop)
    {
        if (!active || EndDoc(dc) <= 0) throw new Win32Exception();
        active = false;
        var inactivity = System.Diagnostics.Stopwatch.StartNew();
        long lastSize = -1;
        while (inactivity.Elapsed < TimeSpan.FromMinutes(3))
        {
            stop.ThrowIfCancellationRequested();
            try
            {
                using var result = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (result.Length != lastSize) { lastSize = result.Length; inactivity.Restart(); }
                if (CompletePdf(result)) return;
            }
            catch (IOException) { }
            stop.WaitHandle.WaitOne(150);
        }
        throw new IOException("Windows PDF 출력이 완료되지 않았습니다.");
    }

    internal static bool CompletePdf(Stream file)
    {
        if (file.Length < 12) return false;
        Span<byte> signature = stackalloc byte[5];
        file.Position = 0;
        file.ReadExactly(signature);
        if (!signature.SequenceEqual("%PDF-"u8)) return false;
        byte[] tail = new byte[(int)Math.Min(1024, file.Length)];
        file.Position = file.Length - tail.Length;
        file.ReadExactly(tail);
        return tail.AsSpan().LastIndexOf("%%EOF"u8) >= 0;
    }

    public void Dispose()
    {
        if (active) AbortDoc(dc);
        if (dc != IntPtr.Zero) DeleteDC(dc);
        fonts.Dispose();
    }
}

internal sealed class SpoolFonts : IDisposable
{
    private readonly Dictionary<ulong, byte[]> subsets = [];
    private readonly List<byte[]> complete = [];
    private readonly List<IntPtr> installed = [];
    private long total;

    [DllImport("gdi32.dll")] private static extern IntPtr AddFontMemResourceEx(byte[] data, uint size, IntPtr reserved, out uint count);
    [DllImport("gdi32.dll")] private static extern bool RemoveFontMemResourceEx(IntPtr font);
    [DllImport("fontsub.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern uint MergeFontPackage(byte[]? original, uint originalSize, byte[] package, uint packageSize,
        out IntPtr result, out uint allocated, out uint written, ushort mode, IntPtr alloc, IntPtr realloc, IntPtr free, IntPtr reserved);
    [DllImport("ucrtbase.dll", CallingConvention = CallingConvention.Cdecl)] private static extern void free(IntPtr address);
    private static readonly IntPtr Crt = NativeLibrary.Load("ucrtbase.dll", typeof(SpoolFonts).Assembly, DllImportSearchPath.System32);

    internal void Read(ReadOnlySpan<byte> record)
    {
        if (record.Length < 20 || !record.Slice(16, 4).SequenceEqual("FNOT"u8)) return;
        if (record.Length < 36) throw new InvalidDataException("내장 글꼴 기록이 잘렸습니다.");
        int kind = BitConverter.ToInt32(record[20..]);
        int size = BitConverter.ToInt32(record[24..]);
        if (size < 8 || size > record.Length - 28 || size > 32 * 1024 * 1024) throw new InvalidDataException("내장 글꼴 크기가 잘못되었습니다.");
        var data = record.Slice(28, size);
        bool subset = kind is 7 or 8;
        if (!subset && kind != 2) throw new InvalidDataException("지원하지 않는 내장 글꼴 형식입니다.");
        ulong id = BitConverter.ToUInt64(data);
        subsets.TryGetValue(id, out var previous);
        byte[] font;
        if (subset)
        {
            if (kind == 8 && previous == null) throw new InvalidDataException("내장 글꼴의 첫 부분이 없습니다.");
            var pack = data[8..].ToArray();
            byte[]? origin = kind == 8 ? previous! : null;
            uint error = MergeFontPackage(origin, (uint)(origin?.Length ?? 0), pack, (uint)pack.Length,
                out var result, out uint allocated, out uint written, (ushort)(kind == 7 ? 1 : 2),
                NativeLibrary.GetExport(Crt, "malloc"), NativeLibrary.GetExport(Crt, "realloc"), NativeLibrary.GetExport(Crt, "free"), IntPtr.Zero);
            try
            {
                if (error != 0 || result == IntPtr.Zero || written == 0 || written > allocated || written > 64 * 1024 * 1024)
                    throw new InvalidDataException("내장 글꼴을 복원하지 못했습니다.");
                font = GC.AllocateUninitializedArray<byte>((int)written);
                Marshal.Copy(result, font, 0, font.Length);
            }
            finally { free(result); }
        }
        else
        {
            if (data.Length < 16 || BitConverter.ToInt32(data) != 0 || BitConverter.ToInt32(data[4..]) != 1)
                throw new InvalidDataException("지원하지 않는 내장 글꼴 구성입니다.");
            int count = BitConverter.ToInt32(data[8..]), skip = BitConverter.ToInt32(data[12..]);
            if (skip is < 0 or > 7 || count <= 0 || count > data.Length - 16 - skip) throw new InvalidDataException();
            font = data.Slice(16 + skip, count).ToArray();
        }
        total += font.Length - (subset ? previous?.Length ?? 0 : 0);
        if (total > 256L * 1024 * 1024 || subsets.Count + complete.Count >= 2048) throw new InvalidDataException("인쇄 작업의 글꼴 용량이 너무 큽니다.");
        if (subset) subsets[id] = font;
        else complete.Add(font);
    }

    internal void Activate()
    {
        foreach (var font in complete.Concat(subsets.Values))
        {
            var handle = AddFontMemResourceEx(font, (uint)font.Length, IntPtr.Zero, out _);
            if (handle == IntPtr.Zero) throw new InvalidDataException("Windows에서 내장 글꼴을 열 수 없습니다.");
            installed.Add(handle);
        }
        subsets.Clear();
        complete.Clear();
    }

    public void Dispose()
    {
        foreach (var handle in installed) RemoveFontMemResourceEx(handle);
    }
}
