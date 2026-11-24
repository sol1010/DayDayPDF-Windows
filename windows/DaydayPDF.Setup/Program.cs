using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using DaydayPDF.Printing;
using System.Printing;

namespace DaydayPDF.Setup;

internal static class Program
{
    private const string Product = "DaydayPDF";
    private const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\DaydayPDF";
    private const string ProgId = "DaydayPDF.Document";
    private static readonly string InstallRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product);
    private static readonly string Executable = Path.Combine(InstallRoot, "DaydayPDF.exe");
    private static readonly string SetupPath = Path.Combine(InstallRoot, "DaydayPDF.Setup.exe");
    private static readonly string ReceiverPath = Path.Combine(InstallRoot, "DaydayPDF.PrintReceiver.exe");
    private static readonly string PdfIconPath = Path.Combine(InstallRoot, "pdf.ico");
    private static readonly string Marker = Path.Combine(InstallRoot, "installed-by-daydaypdf.txt");
    private static readonly string Version = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "Preview";

    [STAThread]
    public static int Main(string[] args)
    {
        if (args is ["--apply-after-exit", var pid] && int.TryParse(pid, out var parent) && parent > 0)
        {
            try
            {
                Process? editor;
                try { editor = Process.GetProcessById(parent); } catch (ArgumentException) { editor = null; }
                using (editor)
                {
                    try
                    {
                        if (editor is not null && !editor.HasExited &&
                            (!string.Equals(editor.MainModule?.FileName, Executable, StringComparison.OrdinalIgnoreCase) || !editor.WaitForExit(60000))) return 1;
                    }
                    catch (InvalidOperationException) when (editor?.HasExited == true) { }
                    catch (System.ComponentModel.Win32Exception) when (editor?.HasExited == true) { }
                }
                if (!Equals(Registry.GetValue(@"HKEY_CURRENT_USER\Software\DaydayPDF\Updates", "Automatic", 0), 1)) return 0;
                if (!File.Exists(Marker) || !File.Exists(Executable)) return 0;
                if (new System.Version(FileVersionInfo.GetVersionInfo(Executable).FileVersion!) >= typeof(Program).Assembly.GetName().Version!) return 0;
                Install();
                return 0;
            }
            catch (Exception error) { File.WriteAllText(Path.Combine(Path.GetTempPath(), "DaydayPDF-setup-error.txt"), error.Message); return 1; }
        }
        bool uninstall = args.Contains("--uninstall");
        if (args.Contains("--silent"))
        {
            try { if (uninstall) Uninstall(); else Install(); return 0; }
            catch (Exception error) { File.WriteAllText(Path.Combine(Path.GetTempPath(), "DaydayPDF-setup-error.txt"), error.ToString()); return 1; }
        }
        var app = new Application();
        var window = new Window { Title = Product + (uninstall ? " 제거" : " 설치"), Width = 510, Height = 335,
            ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterScreen };
        var panel = new StackPanel { Margin = new Thickness(28) };
        panel.Children.Add(new TextBlock { Text = Product + " · " + Version, FontSize = 22, FontWeight = FontWeights.SemiBold });
        var status = new TextBlock { Margin = new Thickness(0, 18, 0, 18), TextWrapping = TextWrapping.Wrap,
            Text = uninstall ? "PC 프로그램과 설치 시 추가한 DaydayPDF 프린터를 제거합니다. 저장한 PDF와 편집기 복구 데이터는 유지됩니다."
            : "PC 편집기를 설치하고 DaydayPDF 프린터를 추가합니다.\n다른 프로그램에서 DaydayPDF로 출력하면 저장 창 없이 편집기에서 열립니다. 인쇄 수신기는 Windows 로그인 시 백그라운드에서 시작합니다.\n\n설치 위치: " + InstallRoot };
        panel.Children.Add(status);
        var button = new Button { Content = uninstall ? "제거" : "설치 및 업데이트", Height = 38 };
        bool completed = false;
        button.Click += async (_, _) => {
            if (completed) { window.Close(); return; }
            button.IsEnabled = false; status.Text = uninstall ? "제거 중…" : "설치 중…";
            try {
                await Task.Run(() => { if (uninstall) Uninstall(); else Install(); });
                status.Text = uninstall ? "제거했습니다. 이 창을 닫으면 설치 프로그램 파일도 삭제됩니다."
                    : "설치했습니다. 시작 메뉴에서 DaydayPDF를 실행할 수 있습니다.\n인쇄 화면에 DaydayPDF 프린터가 추가되었습니다.";
                button.Content = "닫기"; button.IsEnabled = true;
                completed = true;
            } catch (Exception error) {
                status.Text = "완료하지 못했습니다.\n" + error.Message; button.IsEnabled = true;
            }
        };
        panel.Children.Add(button); window.Content = panel;
        app.Run(window); return 0;
    }

    private static Mutex AcquireSetupLock()
    {
        var mutex = new Mutex(false, @"Local\DayDayPDF.Setup." + PrintInbox.UserKey, out bool acquired);
        if (acquired) return mutex;
        mutex.Dispose();
        throw new IOException("다른 설치 작업이 진행 중입니다.");
    }

    private static void RequireOwnedDirectory()
    {
        string expected = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product));
        if (!Path.GetFullPath(InstallRoot).Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new IOException("설치 경로가 올바르지 않습니다.");
        if (Directory.Exists(InstallRoot) && new DirectoryInfo(InstallRoot).Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("연결된 폴더에는 설치할 수 없습니다.");
        if (Directory.Exists(InstallRoot) && Directory.EnumerateFileSystemEntries(InstallRoot).Any() &&
            (!File.Exists(Marker) || File.ReadAllText(Marker) != "DaydayPDF.Setup.v1"))
            throw new IOException("설치 폴더에 다른 파일이 있습니다. 기존 폴더를 확인하세요.");
    }

    private static void Install()
    {
        using var lockFile = AcquireSetupLock();
        RequireOwnedDirectory();
        using Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("DaydayPDF.exe")
            ?? throw new IOException("설치 파일에 PC 프로그램이 없습니다.");
        using Stream pdfIcon = Assembly.GetExecutingAssembly().GetManifestResourceStream("DaydayPDF.pdf.ico")
            ?? throw new IOException("PDF 파일 아이콘이 없습니다.");
        Directory.CreateDirectory(InstallRoot);
        if (File.Exists(Executable)) using (File.Open(Executable, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
        using (var server = new LocalPrintServer())
        using (var queues = server.GetPrintQueues())
            if (queues.Any(queue => queue.Name == Product && queue.NumberOfJobs > 0))
                throw new IOException("DaydayPDF 인쇄가 끝난 뒤 업데이트하세요.");
        string staging = Path.Combine(InstallRoot, "DaydayPDF.new");
        string backup = Path.Combine(InstallRoot, "DaydayPDF.previous");
        string receiverBackup = ReceiverPath + ".previous";
        string iconBackup = PdfIconPath + ".previous";
        bool hadPdfIcon = File.Exists(PdfIconPath);
        StopReceiver();
        try
        {
            using (var destination = new FileStream(staging, FileMode.Create, FileAccess.Write, FileShare.None)) payload.CopyTo(destination);
            if (File.Exists(Executable)) File.Replace(staging, Executable, backup, true);
            else File.Move(staging, Executable);
            File.WriteAllText(Marker, "DaydayPDF.Setup.v1");
            if (File.Exists(ReceiverPath)) File.Copy(ReceiverPath, receiverBackup, true);
            using (var receiver = Assembly.GetExecutingAssembly().GetManifestResourceStream("DaydayPDF.PrintReceiver.exe")
                ?? throw new IOException("인쇄 수신기 파일이 없습니다."))
            using (var destination = File.Create(ReceiverPath)) receiver.CopyTo(destination);
            if (hadPdfIcon) File.Copy(PdfIconPath, iconBackup, true);
            using (var destination = File.Create(PdfIconPath)) pdfIcon.CopyTo(destination);
            StartReceiver();
            RunPrinterScript(false);
            string self = Environment.ProcessPath ?? throw new IOException("설치 프로그램 경로를 찾지 못했습니다.");
            if (!self.Equals(SetupPath, StringComparison.OrdinalIgnoreCase)) File.Copy(self, SetupPath, true);
            RegisterApplication();
            CreateShortcut();
            File.Delete(backup);
            File.Delete(receiverBackup);
            File.Delete(iconBackup);
        }
        catch
        {
            StopReceiver();
            if (File.Exists(receiverBackup)) File.Move(receiverBackup, ReceiverPath, true);
            if (File.Exists(backup)) File.Move(backup, Executable, true);
            if (File.Exists(iconBackup)) File.Move(iconBackup, PdfIconPath, true);
            else if (!hadPdfIcon) File.Delete(PdfIconPath);
            if (File.Exists(ReceiverPath)) StartReceiver();
            throw;
        }
        finally { File.Delete(staging); }
    }

    private static void RegisterApplication()
    {
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Product); key.SetValue("DisplayVersion", Version);
            key.SetValue("Publisher", Product); key.SetValue("InstallLocation", InstallRoot);
            key.SetValue("DisplayIcon", Executable); key.SetValue("UninstallString", $"\"{SetupPath}\" --uninstall");
            key.SetValue("NoModify", 1); key.SetValue("NoRepair", 1);
        }
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Classes\" + ProgId)) key.SetValue("", "PDF 문서");
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Classes\" + ProgId + @"\shell\open\command")) key.SetValue("", $"\"{Executable}\" \"%1\"");
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Classes\" + ProgId + @"\DefaultIcon")) key.SetValue("", $"\"{PdfIconPath}\",0");
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Classes\.pdf\OpenWithProgids")) key.SetValue(ProgId, Array.Empty<byte>(), RegistryValueKind.None);
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\DaydayPDF\Capabilities"))
        { key.SetValue("ApplicationName", Product); key.SetValue("ApplicationDescription", "PDF 편집 및 변환"); }
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\DaydayPDF\Capabilities\FileAssociations")) key.SetValue(".pdf", ProgId);
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\RegisteredApplications")) key.SetValue(Product, @"SOFTWARE\DaydayPDF\Capabilities");
        using (var key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")) key.SetValue("DaydayPDF Print Receiver", $"\"{ReceiverPath}\"");
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }

    private static string ShortcutPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "DaydayPDF.lnk");
    private static void CreateShortcut()
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new IOException("시작 메뉴 바로가기를 만들 수 없습니다.");
        dynamic shell = Activator.CreateInstance(shellType)!;
        try {
            dynamic shortcut = shell.CreateShortcut(ShortcutPath);
            try { shortcut.TargetPath = Executable; shortcut.WorkingDirectory = InstallRoot; shortcut.IconLocation = Executable + ",0"; shortcut.Save(); }
            finally { Marshal.FinalReleaseComObject(shortcut); }
        } finally { Marshal.FinalReleaseComObject(shell); }
    }

    private static void Uninstall()
    {
        using var lockFile = AcquireSetupLock();
        RequireOwnedDirectory();
        if (!File.Exists(Marker)) throw new IOException("DaydayPDF 설치 정보를 찾지 못했습니다.");
        if (File.Exists(Executable)) using (File.Open(Executable, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
        RunPrinterScript(true);
        StopReceiver();
        File.Delete(ReceiverPath);
        File.Delete(PdfIconPath);
        File.Delete(Executable); File.Delete(ShortcutPath);
        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        Registry.CurrentUser.DeleteSubKeyTree(@"SOFTWARE\Classes\" + ProgId, false);
        Registry.CurrentUser.DeleteSubKeyTree(@"SOFTWARE\DaydayPDF\Capabilities", false);
        using (var key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Classes\.pdf\OpenWithProgids", true)) key?.DeleteValue(ProgId, false);
        using (var key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\RegisteredApplications", true)) key?.DeleteValue(Product, false);
        using (var key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
            if (Equals(key?.GetValue("DaydayPDF Print Receiver"), $"\"{ReceiverPath}\"")) key?.DeleteValue("DaydayPDF Print Receiver", false);
        if (string.Equals(Environment.ProcessPath, SetupPath, StringComparison.OrdinalIgnoreCase))
        { ScheduleUninstallerCleanup(); }
        else { File.Delete(SetupPath); File.Delete(Marker); if (!Directory.EnumerateFileSystemEntries(InstallRoot).Any()) Directory.Delete(InstallRoot); }
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }

    private static void ScheduleUninstallerCleanup()
    {
        static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
        string script = $"Wait-Process -Id {Environment.ProcessId} -ErrorAction SilentlyContinue; " +
            $"$installRoot = [IO.Path]::GetFullPath({Quote(InstallRoot)}); " +
            $"if ($installRoot -ne [IO.Path]::GetFullPath([IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Programs', 'DaydayPDF'))) {{ exit 1 }}; " +
            $"if ((Get-Content -LiteralPath {Quote(Marker)} -Raw -ErrorAction SilentlyContinue) -ne 'DaydayPDF.Setup.v1') {{ exit 1 }}; " +
            $"Remove-Item -LiteralPath {Quote(SetupPath)}, {Quote(Marker)} -Force -ErrorAction SilentlyContinue; " +
            "if (-not (Get-ChildItem -LiteralPath $installRoot -Force)) { [IO.Directory]::Delete($installRoot) }";
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"))
            { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-EncodedCommand");
        start.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes(script)));
        Process.Start(start)?.Dispose();
    }

    private static void RunPrinterScript(bool uninstall)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("InstallPrinter.ps1")!;
        string script = new StreamReader(stream).ReadToEnd();
        script = script.Replace("param([switch]$Uninstall, [string]$PipePort)",
            "$Uninstall = " + (uninstall ? "$true" : "$false") + "; $PipePort = '" + PrintInbox.PortName.Replace("'", "''") + "'");
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe")) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive");
        start.ArgumentList.Add("-EncodedCommand");
        start.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes("[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + script)));
        using var process = Process.Start(start) ?? throw new IOException("프린터 설치를 시작하지 못했습니다.");
        Task<string> stdout = process.StandardOutput.ReadToEndAsync(), stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(180000)) throw new IOException("프린터 설치가 지연되고 있습니다. Windows 기능 상태를 확인한 뒤 다시 시도하세요.");
        if (process.ExitCode == 740) {
            var elevated = new ProcessStartInfo(start.FileName) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
            foreach (string argument in start.ArgumentList) elevated.ArgumentList.Add(argument);
            using var admin = Process.Start(elevated) ?? throw new IOException("Windows PDF 인쇄 기능을 활성화하지 못했습니다.");
            admin.WaitForExit();
            if (admin.ExitCode != 0) throw new IOException("Windows PDF 인쇄 기능 활성화에 실패했습니다. Windows 기능을 확인한 뒤 다시 설치하세요.");
        } else if (process.ExitCode != 0) throw new IOException("프린터 등록 실패: " + stderr.GetAwaiter().GetResult());
    }

    private static void StopReceiver()
    {
        if (!File.Exists(ReceiverPath)) return;
        var start = new ProcessStartInfo(ReceiverPath) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        start.ArgumentList.Add("--stop");
        using var process = Process.Start(start) ?? throw new IOException("인쇄 수신기를 종료하지 못했습니다.");
        if (!process.WaitForExit(25000) || process.ExitCode != 0) throw new IOException("진행 중인 인쇄를 마친 뒤 다시 시도하세요.");
        for (int attempt = 0; ; attempt++)
        {
            try { using var file = File.Open(ReceiverPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None); break; }
            catch (IOException) when (attempt < 50) { Thread.Sleep(100); }
        }
    }

    private static void StartReceiver()
    {
        var start = new ProcessStartInfo(ReceiverPath) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        using var process = Process.Start(start) ?? throw new IOException("인쇄 수신기를 시작하지 못했습니다.");
        string eventName = @"Local\DaydayPDF.PrintReceiver." + PrintInbox.UserKey + ".Ready";
        for (int attempt = 0; attempt < 200; attempt++)
        {
            try { using var ready = EventWaitHandle.OpenExisting(eventName); if (ready.WaitOne(100)) return; }
            catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(100); }
            if (process.HasExited && process.ExitCode != 0) break;
        }
        throw new IOException("인쇄 수신기를 준비하지 못했습니다.");
    }

    [DllImport("shell32.dll")] private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
