param([switch]$Uninstall, [string]$PipePort)
$ErrorActionPreference = 'Stop'
if (-not $PipePort.StartsWith('\\.\pipe\DaydayPDF.Print.S-1-5-')) { throw '인쇄 포트 경로가 올바르지 않습니다.' }
$name = 'DaydayPDF'
$oldName = 'DaydayPDF (ezPDF 고속)'
$driver = 'MS Publisher Color Printer'
$native = 'Microsoft Print To PDF'
$legacyComment = 'DaydayPDF installed printer - unified EMF'
$oldComment = 'DaydayPDF installed printer - ezPDF EMF'
$pipeComment = 'DaydayPDF installed printer - Microsoft Print To PDF'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DaydayPrinterSettings {
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern int DocumentProperties(IntPtr window,IntPtr printer,string name,IntPtr output,IntPtr input,int flags);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool SetPrinter(IntPtr printer,int level,ref IntPtr info,int command);
    [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr printer);
    [StructLayout(LayoutKind.Sequential)]
    struct Defaults { public IntPtr DataType, Mode; public uint Access; }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool OpenForWrite(string name,out IntPtr handle,ref Defaults defaults);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)]
    static extern int SetPrinterData(IntPtr printer,string key,int type,ref int value,int bytes);
    public static void Mark(string name) {
        var defaults = new Defaults { Access=4 };
        IntPtr printer;
        if(!OpenForWrite(name,out printer,ref defaults))throw new Win32Exception();
        try {
            int value=1;
            int error=SetPrinterData(printer,"DaydayPDF.QueueOwner",4,ref value,4);
            if(error!=0)throw new Win32Exception(error);
        } finally { ClosePrinter(printer); }
    }
    public static void SetLandscapeA3(string name) {
        IntPtr printer, mode=IntPtr.Zero;
        if(!OpenPrinter(name,out printer,IntPtr.Zero))throw new Win32Exception();
        try {
            int bytes=DocumentProperties(IntPtr.Zero,printer,name,IntPtr.Zero,IntPtr.Zero,0);
            if(bytes<166 || bytes>65536)throw new InvalidOperationException("Invalid printer settings");
            mode=Marshal.AllocHGlobal(bytes);
            if(DocumentProperties(IntPtr.Zero,printer,name,mode,IntPtr.Zero,2)!=1)throw new Win32Exception();
            Marshal.WriteInt32(mode,72,(Marshal.ReadInt32(mode,72)&~0x1000c)|3);
            Marshal.WriteInt16(mode,76,2);
            Marshal.WriteInt16(mode,78,8);
            if(DocumentProperties(IntPtr.Zero,printer,name,mode,mode,10)!=1 ||
               Marshal.ReadInt16(mode,76)!=2 || Marshal.ReadInt16(mode,78)!=8)
                throw new InvalidOperationException("A3 landscape is unavailable");
            if(!SetPrinter(printer,9,ref mode,0))throw new Win32Exception();
        } finally { if(mode!=IntPtr.Zero)Marshal.FreeHGlobal(mode);ClosePrinter(printer); }
    }
}
'@
function Test-Marked {
    $key = 'HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Print\Printers\DaydayPDF\PrinterDriverData'
    [Microsoft.Win32.Registry]::GetValue($key, 'DaydayPDF.QueueOwner', 0) -eq 1
}
function Test-EmfPrinter($p, $label) { $p -and $p.DriverName -eq $driver -and $p.PortName -eq 'NUL:' -and $p.Comment -eq $label }
function Test-PipePrinter($p) { $p -and $p.DriverName -eq $native -and $p.Comment -eq $pipeComment -and $p.PortName -in @($PipePort, 'PORTPROMPT:') }
function Assert-Idle($printerName) {
    if (Get-PrintJob -PrinterName $printerName -ErrorAction Stop) { throw "$printerName 인쇄가 끝난 뒤 다시 시도하세요." }
}
function Remove-OldPort {
    if ((Get-PrinterPort -Name $PipePort -ErrorAction SilentlyContinue) -and !(Get-Printer | Where-Object PortName -eq $PipePort)) {
        Remove-PrinterPort -Name $PipePort -ErrorAction SilentlyContinue
    }
}
$p = Get-Printer -Name $name -ErrorAction SilentlyContinue
$f = Get-Printer -Name $oldName -ErrorAction SilentlyContinue
$marked = $p -and (Test-Marked)
$unified = $p -and $p.DriverName -eq $driver -and $p.PortName -eq 'NUL:' -and ($marked -or $p.Comment -eq $legacyComment)
$pipe = Test-PipePrinter $p
$fast = Test-EmfPrinter $f $oldComment
if ($Uninstall) {
    if ($unified -or $pipe) { Assert-Idle $name }
    if ($fast) { Assert-Idle $oldName }
    if ($unified -or $pipe) { Remove-Printer -Name $name }
    if ($fast) { Remove-Printer -Name $oldName }
    Remove-OldPort
    exit 0
}
if ($p -and !($unified -or $pipe)) { throw 'DaydayPDF 이름을 다른 프린터가 사용하고 있습니다.' }
if ($p) { Assert-Idle $name }
if ($fast) { Assert-Idle $oldName }
$isAdmin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!(Get-PrinterDriver -Name $native -ErrorAction SilentlyContinue)) {
    if (!$isAdmin) { exit 740 }
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Printing-PrintToPDFServices-Features
    if ($feature.State -ne 'Enabled') {
        $enabled = Enable-WindowsOptionalFeature -Online -FeatureName Printing-PrintToPDFServices-Features -All -NoRestart
        if ($enabled.RestartNeeded) { throw 'Windows를 다시 시작한 후 설치하세요.' }
    }
    Add-PrinterDriver -Name $native
}
if (!(Get-Printer | Where-Object { $_.DriverName -eq $native -and $_.PortName -eq 'PORTPROMPT:' -and $_.Name -ne $name })) {
    if (Get-Printer -Name 'Microsoft Print to PDF' -ErrorAction SilentlyContinue) { throw 'Windows PDF 프린터 설정을 확인하세요.' }
    Add-Printer -Name 'Microsoft Print to PDF' -DriverName $native -PortName 'PORTPROMPT:'
}
if (!(Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue)) {
    if (!$isAdmin) { exit 740 }
    Add-PrinterDriver -Name $driver
}
if (!(Get-PrinterPort -Name 'NUL:' -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name 'NUL:' }
$oldDefault = (Get-CimInstance Win32_Printer -Filter 'Default=True').Name
$backup = 'DaydayPDF-migration-' + [Guid]::NewGuid().ToString('N')
$movedPipe = $false
$movedFast = $false
$created = $false
try {
    if ($pipe) {
        Assert-Idle $name
        Rename-Printer -Name $name -NewName $backup
        $movedPipe = $true
    }
    if (!$unified) {
        if ($fast) {
            Assert-Idle $oldName
            Rename-Printer -Name $oldName -NewName $name
            $movedFast = $true
        } else {
            Add-Printer -Name $name -DriverName $driver -PortName 'NUL:' -PrintProcessor winprint -KeepPrintedJobs
            $created = $true
        }
    }
    if ($created -or $movedFast) {
        [DaydayPrinterSettings]::SetLandscapeA3($name)
    }
    if (!$marked) {
        [DaydayPrinterSettings]::Mark($name)
        if (!(Test-Marked)) { throw 'DaydayPDF 프린터 등록 정보를 확인하지 못했습니다.' }
    }
    $current = Get-Printer -Name $name
    if ($current.Comment -in @($legacyComment, $oldComment)) { Set-Printer -Name $name -Comment ([string]::Empty) }
    Set-Printer -Name $name -KeepPrintedJobs $true
    $device = Get-CimInstance Win32_Printer -Filter "Name='$name'"
    if (!([int](Get-Printer -Name $name).PrinterStatus -band 1)) {
        if ((Invoke-CimMethod -InputObject $device -MethodName Pause).ReturnValue -ne 0) { throw '인쇄 수신을 준비하지 못했습니다.' }
    }
    $result = Get-Printer -Name $name
    if ((!(Test-Marked) -or $result.DriverName -ne $driver -or $result.PortName -ne 'NUL:' -or $result.Comment -in @($legacyComment, $oldComment)) -or !$result.KeepPrintedJobs -or !([int]$result.PrinterStatus -band 1)) { throw 'DaydayPDF 프린터 등록을 확인하지 못했습니다.' }
    if ($oldDefault -eq $name -or ($fast -and $oldDefault -eq $oldName)) {
        if ((Invoke-CimMethod -InputObject $device -MethodName SetDefaultPrinter).ReturnValue -ne 0) { throw '기본 프린터를 복원하지 못했습니다.' }
    }
    if ($movedPipe) { Assert-Idle $backup; Remove-Printer -Name $backup }
    if ($unified -and $fast) { Assert-Idle $oldName; Remove-Printer -Name $oldName }
} catch {
    if ($unified -and $p.Comment -eq $legacyComment -and (Get-Printer -Name $name).Comment -eq '') { Set-Printer -Name $name -Comment $legacyComment }
    if ($created) { Assert-Idle $name; Remove-Printer -Name $name }
    if ($movedFast) { Assert-Idle $name; Set-Printer -Name $name -Comment $oldComment; Rename-Printer -Name $name -NewName $oldName }
    if ($movedPipe) { Rename-Printer -Name $backup -NewName $name }
    throw
}
Remove-OldPort
