param([switch]$Uninstall, [string]$PipePort)
$ErrorActionPreference = 'Stop'
if (-not $PipePort.StartsWith('\\.\pipe\DaydayPDF.Print.S-1-5-')) { throw '인쇄 포트 경로가 올바르지 않습니다.' }
$printerName = 'DaydayPDF'
$ownerComment = 'DaydayPDF installed printer - Microsoft Print To PDF'
$printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if ($Uninstall) {
    if ($printer -and $printer.Comment -eq $ownerComment -and $printer.DriverName -eq 'Microsoft Print To PDF' -and $printer.PortName -in @('PORTPROMPT:', $PipePort)) {
        if (Get-PrintJob -PrinterName $printerName -ErrorAction Stop) { throw 'DaydayPDF 인쇄 대기열을 비운 뒤 제거하세요.' }
        Remove-Printer -Name $printerName
    }
    if ((Get-PrinterPort -Name $PipePort -ErrorAction SilentlyContinue) -and -not (Get-Printer | Where-Object PortName -eq $PipePort)) { Remove-PrinterPort -Name $PipePort }
    exit 0
}
if ($printer) {
    if ($printer.Comment -ne $ownerComment -or $printer.DriverName -ne 'Microsoft Print To PDF' -or $printer.PortName -notin @('PORTPROMPT:', $PipePort)) {
        throw 'DaydayPDF라는 이름을 다른 프린터가 사용 중입니다. 기존 프린터 이름을 변경한 뒤 다시 설치하세요.'
    }
    if (Get-PrintJob -PrinterName $printerName -ErrorAction Stop) { throw 'DaydayPDF 인쇄가 끝난 뒤 업데이트하세요.' }
}
$driver = Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue
if (-not $driver) {
    if (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) { exit 740 }
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Printing-PrintToPDFServices-Features
    if ($feature.State -ne 'Enabled') {
        $enabled = Enable-WindowsOptionalFeature -Online -FeatureName Printing-PrintToPDFServices-Features -All -NoRestart
        if ($enabled.RestartNeeded) { throw 'Windows PDF 인쇄 기능을 켰습니다. Windows를 다시 시작한 뒤 설치를 실행하세요.' }
    }
    Add-PrinterDriver -Name 'Microsoft Print To PDF'
}
if (-not (Get-PrinterPort -Name $PipePort -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name $PipePort }
if ($printer) { Set-Printer -Name $printerName -PortName $PipePort }
else { Add-Printer -Name $printerName -DriverName 'Microsoft Print To PDF' -PortName $PipePort -Comment $ownerComment }
$installed = Get-Printer -Name $printerName
if ($installed.DriverName -ne 'Microsoft Print To PDF' -or $installed.PortName -ne $PipePort) { throw 'DaydayPDF 프린터 등록을 확인하지 못했습니다.' }
