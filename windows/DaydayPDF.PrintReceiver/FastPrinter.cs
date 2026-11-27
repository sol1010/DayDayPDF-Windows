using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
using DaydayPDF.Printing;

namespace DaydayPDF.PrintReceiver;

internal static class FastPrinter
{
    private const string Queue = "DaydayPDF";
    private const string Driver = "MS Publisher Color Printer";
    private const uint Spooling = 8, Printing = 16, Removing = 4 | 256, Finished = 128 | 4096 | 8192;
    [StructLayout(LayoutKind.Sequential)]
    private struct Defaults { public IntPtr Type, Mode; public uint Access; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Info
    {
        public uint Id;
        public IntPtr Printer, Machine, User, Document, Notify, Type, Processor, Parameters, Driver, Mode, StatusText, Security;
        public uint Status, Priority, Position, Start, Until, Pages, Size;
        public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Millisecond;
        public uint Elapsed, Printed;
    }
    private sealed record Job(uint Id, string Key, string Title, uint Pages, uint Size, DateTime Submitted, string DataType, byte[] Mode);
    private sealed class PrinterHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public PrinterHandle() : base(true) { }
        protected override bool ReleaseHandle() => ClosePrinter(handle);
    }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out PrinterHandle handle, ref Defaults defaults);
    [DllImport("winspool.drv")] private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumJobs(PrinterHandle handle, uint first, uint count, uint level, IntPtr data, uint size, out uint needed, out uint returned);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetJob(PrinterHandle handle, uint id, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetJob(PrinterHandle handle, uint id, uint level, IntPtr data, uint command);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ReadPrinter(PrinterHandle handle, IntPtr data, uint size, out uint actual);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDC(string driver, string device, string? output, byte[] mode);
    [DllImport("gdi32.dll")] private static extern int GetDeviceCaps(IntPtr dc, int index);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBox(IntPtr owner, string text, string title, uint flags);
    private static string Text(IntPtr value) => Marshal.PtrToStringUni(value) ?? "";
    private static PrinterHandle Open(string name, uint access)
    {
        var args = new Defaults { Access = access };
        if (!OpenPrinter(name, out var result, ref args)) throw new Win32Exception();
        return result;
    }
    private static Job? Snapshot(Info data, string owner)
    {
        string submittedBy = Text(data.User);
        if (!(submittedBy.Equals(owner, StringComparison.OrdinalIgnoreCase) ||
            submittedBy.Equals(Environment.UserName, StringComparison.OrdinalIgnoreCase)) ||
            !Text(data.Printer).Equals(Queue, StringComparison.OrdinalIgnoreCase) ||
            !Text(data.Driver).Equals(Driver, StringComparison.OrdinalIgnoreCase) ||
            (data.Status & (Spooling | Removing)) != 0 || ((data.Status & Printing) != 0 && (data.Status & Finished) == 0) ||
            (data.Size == 0 && data.Pages == 0)) return null;
        var submitted = new DateTime(data.Year, data.Month, data.Day, data.Hour, data.Minute, data.Second, data.Millisecond, DateTimeKind.Utc);
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{PrintInbox.UserKey}/{data.Id}/{submitted.Ticks}")))[..32];
        byte[] mode = [];
        if (data.Mode != IntPtr.Zero && Text(data.Type).StartsWith("NT EMF", StringComparison.Ordinal))
        {
            int n = unchecked((ushort)Marshal.ReadInt16(data.Mode, 68)) + unchecked((ushort)Marshal.ReadInt16(data.Mode, 70));
            if (n is >= 166 and <= 131072) { mode = new byte[n]; Marshal.Copy(data.Mode, mode, 0, n); }
        }
        return new(data.Id, key, Text(data.Document), data.Pages, data.Size, submitted, Text(data.Type), mode);
    }
    private static List<Job> Jobs(PrinterHandle h, string owner)
    {
        const int batch = 32;
        var result = new List<Job>(); int stride = Marshal.SizeOf<Info>();
        for (uint first = 0; ; first += batch)
        {
            if (EnumJobs(h, first, batch, 2, IntPtr.Zero, 0, out uint need, out _)) break;
            if (Marshal.GetLastWin32Error() != 122 || need > 16 * 1024 * 1024 || need == 0) throw new Win32Exception();
            IntPtr buffer = Marshal.AllocHGlobal((int)need);
            try
            {
                if (!EnumJobs(h, first, batch, 2, buffer, need, out _, out uint count)) throw new Win32Exception();
                for (int i = 0; i < count; i++)
                {
                    var job = Snapshot(Marshal.PtrToStructure<Info>(IntPtr.Add(buffer, i * stride)), owner);
                    if (job != null) result.Add(job);
                }
                if (count < batch) break;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        return result;
    }
    private static bool Current(PrinterHandle h, Job job, string owner)
    {
        GetJob(h, job.Id, 2, IntPtr.Zero, 0, out uint need);
        if (need == 0 || need > 4 * 1024 * 1024) return false;
        IntPtr data = Marshal.AllocHGlobal((int)need);
        try { return GetJob(h, job.Id, 2, data, need, out _) && Snapshot(Marshal.PtrToStructure<Info>(data), owner)?.Key == job.Key; }
        finally { Marshal.FreeHGlobal(data); }
    }
    private sealed class JobStream(PrinterHandle handle) : Stream
    {
        public override int Read(byte[] data, int offset, int count)
        {
            var pin = GCHandle.Alloc(data, GCHandleType.Pinned);
            try
            {
                if (!ReadPrinter(handle, IntPtr.Add(pin.AddrOfPinnedObject(), offset), (uint)count, out uint n)) throw new Win32Exception();
                if (n > 0) ReceiverProgress.Advanced();
                return checked((int)n);
            }
            finally { pin.Free(); }
        }
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException(); public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override long Seek(long n, SeekOrigin where) => throw new NotSupportedException();
        public override void SetLength(long n) => throw new NotSupportedException();
        public override void Write(byte[] data, int offset, int count) => throw new NotSupportedException();
        public override void Flush() { }
    }
    internal static int[] DeviceCaps(byte[] mode)
    {
        EmfPage.Require(mode.Length >= 166 && BitConverter.ToUInt16(mode, 68) >= 166 &&
            BitConverter.ToUInt16(mode, 68) + BitConverter.ToUInt16(mode, 70) <= mode.Length);
        const int dmScale = 0x10;
        if ((BitConverter.ToInt32(mode, 72) & dmScale) != 0 && BitConverter.ToInt16(mode, 84) != 100)
        {
            // The EMF already contains the scaled drawing. Measure the physical paper at 100%.
            mode = (byte[])mode.Clone();
            BitConverter.TryWriteBytes(mode.AsSpan(84), (short)100);
        }
        var dc = CreateDC("WINSPOOL", Queue, null, mode);
        if (dc == IntPtr.Zero) throw new Win32Exception();
        try { return new[] { 8, 10, 88, 90, 110, 111, 112, 113 }.Select(i => GetDeviceCaps(dc, i)).ToArray(); }
        finally { DeleteDC(dc); }
    }
    private sealed class LatePageModeException : IOException { }
    internal static void ConvertSpool(Stream input, Stream output, byte[] mode, Func<byte[], Paper> geometry, uint expected, CancellationToken stop, bool defer = false)
    {
        var pdf = new VectorPdf(output);
        pdf.Start();
        byte[]? previous = null;
        Paper? paper = null;
        ReadPages(input, mode, expected, (source, length, settings, token) =>
        {
            if (previous != settings) { paper = geometry(settings); previous = settings; }
            new EmfPage(pdf, paper!).Render(source, length, token);
        }, stop, defer);
        pdf.Finish();
    }
    internal static void ReadPages(Stream input, byte[] mode, uint expected, Action<Stream,int,byte[],CancellationToken> render, CancellationToken stop, bool defer = false, bool ignoreModeChanges = false)
    {
        using var reader = new BinaryReader(input, Encoding.UTF8, true);
        EmfPage.Require(reader.ReadUInt32() == 65536);
        int header = reader.ReadInt32(); EmfPage.Require(header is >= 16 and <= 1048576);
        input.ReadExactly(new byte[header - 8]);
        int pages = 0; long pos = header, pageStart = -1;
        byte[]? pending = null;
        while (true)
        {
            stop.ThrowIfCancellationRequested();
            int first = input.ReadByte(); if (first < 0) break;
            int type = first | (reader.ReadByte() << 8) | (reader.ReadByte() << 16) | (reader.ReadByte() << 24);
            int n = reader.ReadInt32(); long start = pos; pos += 8L + n;
            EmfPage.Require(n >= 0 && pos <= 8L * 1024 * 1024 * 1024);
            switch (type)
            {
                case 12:
                    EmfPage.Require(pageStart < 0 && n is >= 88 and <= 268435456 && ++pages <= 10000);
                    pageStart = start;
                    if (defer) { pending = GC.AllocateUninitializedArray<byte>(n); input.ReadExactly(pending); }
                    else render(input, n, mode, stop);
                    break;
                case 3:
                    EmfPage.Require(n is >= 166 and <= 131072);
                    var next = new byte[n]; input.ReadExactly(next);
                    if (pageStart >= 0 && !defer && !ignoreModeChanges && !mode.AsSpan().SequenceEqual(next)) throw new LatePageModeException();
                    mode = next; break;
                case 15: case 16: case 17: case 18: case 19: case 21:
                    EmfPage.Require(n == 8 && pageStart >= 0);
                    long offset = reader.ReadInt64();
                    EmfPage.Require(offset > 0 && offset <= start - pageStart);
                    break;
                case 13:
                case 14:
                    EmfPage.Require(n == 8 && pageStart >= 0 && reader.ReadInt64() == start - pageStart);
                    if (pending != null)
                    {
                        using var page = new MemoryStream(pending, 0, pending.Length, false, true);
                        render(page, pending.Length, mode, stop);
                        pending = null;
                    }
                    pageStart = -1; break;
                default: throw new InvalidDataException("지원하지 않는 인쇄 스풀 형식입니다.");
            }
        }
        EmfPage.Require(pages > 0 && pageStart < 0 && (expected == 0 || expected == pages));
    }
    private static void Receive(PrinterHandle printer, Job job, string owner, Action<string> open, HashSet<string> delivered, CancellationToken stop)
    {
        void ReadJob(Action<Stream> read)
        {
            using var raw = Open(Queue + ", Job " + job.Id, 0x20020);
            using var source = new BufferedStream(new JobStream(raw), 262144);
            read(source);
        }
        string template = PrintInbox.NewPath(job.Title);
        string path = Path.Combine(PrintInbox.Root, Path.GetFileNameWithoutExtension(template)[..^49] + "_" + job.Submitted.ToLocalTime().ToString("yyyyMMdd_HHmmss") + "_" + job.Key + ".pdf");
        string staging = path + ".partial.pdf";
        if (!delivered.Contains(job.Key) && !File.Exists(path))
        {
            if (File.Exists(staging)) File.Delete(staging);
            try
            {
                if (job.DataType.Equals("RAW", StringComparison.OrdinalIgnoreCase))
                {
                    ReadJob(source =>
                    {
                        using var dest = new FileStream(staging, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
                        var buffer = new byte[65536];
                        source.ReadExactly(buffer, 0, 5);
                        EmfPage.Require(buffer.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
                        dest.Write(buffer, 0, 5);
                        int count;
                        while ((count = source.Read(buffer)) > 0)
                        {
                            stop.ThrowIfCancellationRequested();
                            EmfPage.Require(dest.Length + count <= 8L * 1024 * 1024 * 1024);
                            dest.Write(buffer, 0, count);
                        }
                        dest.Flush(true);
                        EmfPage.Require(WindowsPdfReplay.CompletePdf(dest));
                    });
                }
                else
                {
                    EmfPage.Require(job.Mode.Length >= 166 && job.DataType.StartsWith("NT EMF", StringComparison.Ordinal));
                    void Convert(bool defer) => ReadJob(source =>
                    {
                        using var dest = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536);
                        ConvertSpool(source, dest, job.Mode, m => Paper.From(m, DeviceCaps(m)), job.Pages, stop, defer);
                        dest.Flush(true);
                    });
                    try
                    {
                        try { Convert(false); }
                        catch (LatePageModeException)
                        {
                            if (!Current(printer, job, owner)) return;
                            File.Delete(staging);
                            Convert(true);
                        }
                    }
                    catch (InvalidDataException)
                    {
                        File.Delete(staging);
                        if (!Current(printer, job, owner)) return;
                        ReceiverProgress.At(ReceiverStage.Converting, job.Id);
                        using var replay = new WindowsPdfReplay(staging, job.Title);
                        ReadJob(source => ReadPages(source, job.Mode, job.Pages, replay.ReadFonts, stop, ignoreModeChanges: true));
                        ReadJob(source => ReadPages(source, job.Mode, job.Pages, replay.Page, stop, true));
                        replay.Finish(stop);
                    }
                }
                if (!Current(printer, job, owner)) return;
                File.Move(staging, path);
            }
            finally { if (File.Exists(staging)) File.Delete(staging); }
        }
        stop.ThrowIfCancellationRequested();
        if (Current(printer, job, owner))
        {
            if (!delivered.Contains(job.Key))
            {
                ReceiverProgress.At(ReceiverStage.Opening, job.Id);
                open(path);
                delivered.Add(job.Key);
            }
            ReceiverProgress.At(ReceiverStage.Acknowledging, job.Id);
            if (!SetJob(printer, job.Id, 0, IntPtr.Zero, 5)) throw new Win32Exception();
        }
    }

    internal sealed record Retry(uint Size, uint Pages, int Attempts, long Next, bool Notified)
    {
        internal bool Wait(uint size, uint pages, long now) => size == Size && pages == Pages && now < Next;
        internal static Retry After(Retry? previous, uint size, uint pages, long now)
        {
            int attempts = previous?.Size == size && previous.Pages == pages ? Math.Min(6, previous.Attempts + 1) : 1;
            int delay = attempts switch { 1 => 2000, 2 => 8000, 3 => 30000, _ => 120000 };
            return new(size, pages, attempts, now + delay, previous?.Notified == true || attempts >= 3);
        }
    }

    internal static async Task Listen(Action<string> open, Action<Exception> log, uint deferredJob, CancellationToken stop)
    {
        string owner = WindowsIdentity.GetCurrent().Name;
        var failed = new Dictionary<string, Retry>();
        var delivered = new HashSet<string>();
        while (!stop.IsCancellationRequested)
        {
            try
            {
                ReceiverProgress.At(ReceiverStage.Queue);
                using var printer = Open(Queue, 8);
                var jobs = Jobs(printer, owner);
                var active = jobs.Select(j => j.Key).ToHashSet();
                delivered.IntersectWith(active);
                foreach (string gone in failed.Keys.Except(active).ToArray()) failed.Remove(gone);
                if (deferredJob != 0 && jobs.Count > 1) jobs = jobs.OrderBy(j => j.Id == deferredJob).ToList();
                foreach (var job in jobs)
                {
                    failed.TryGetValue(job.Key, out var previous);
                    if (previous?.Wait(job.Size, job.Pages, Environment.TickCount64) == true) continue;
                    stop.ThrowIfCancellationRequested();
                    ReceiverProgress.At(ReceiverStage.Reading, job.Id);
                    try { Receive(printer, job, owner, open, delivered, stop); failed.Remove(job.Key); }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        var next = Retry.After(previous, job.Size, job.Pages, Environment.TickCount64);
                        failed[job.Key] = next;
                        if (next.Attempts <= 3) log(new IOException($"인쇄 작업 {job.Id} · {e.GetType().Name}: {e.Message}", e));
                        if (next.Attempts == 3 && previous?.Notified != true)
                            _ = Task.Run(() => MessageBox(IntPtr.Zero, $"인쇄 작업 {job.Id}을 처리하지 못했습니다. 대기열에 보관하고 자동으로 다시 시도합니다.\n\n{e.Message}", "DaydayPDF 인쇄", 0x30));
                    }
                    finally { ReceiverProgress.At(ReceiverStage.Queue); }
                }
            }
            catch (Win32Exception e) when (e.NativeErrorCode == 1801) { await Task.Delay(15000, stop); }
            catch (Exception e) when (e is not OperationCanceledException) { log(e); }
            await Task.Delay(1250, stop);
        }
    }
}
