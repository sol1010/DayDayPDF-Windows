$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'artifacts'
$stage = Join-Path $out 'publish'
function Invoke-Checked($command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "$command failed ($LASTEXITCODE)" }
}
Push-Location $root
try {
    Invoke-Checked node @('scripts/verify-windows-assets.mjs')
    Invoke-Checked npm.cmd @('ci')
    Invoke-Checked npm.cmd @('run', 'build:windows-view')
    Push-Location $PSScriptRoot
    try {
        $common = @('--configuration','Release','--runtime','win-x64','--self-contained','true','-p:PublishSingleFile=true')
        $app = Join-Path $stage 'app'
        $receiver = Join-Path $stage 'receiver'
        $setup = Join-Path $stage 'setup'
        Invoke-Checked dotnet (@('publish','PdfEditor.Preview/PdfEditor.Preview.csproj') + $common + @('--output',$app))
        Invoke-Checked dotnet (@('publish','DaydayPDF.PrintReceiver/DaydayPDF.PrintReceiver.csproj') + $common + @('--output',$receiver))
        $payload = Join-Path $app 'PdfEditor.Preview.exe'
        $receiverExe = Join-Path $receiver 'DaydayPDF.PrintReceiver.exe'
        Invoke-Checked dotnet (@('publish','DaydayPDF.Setup/DaydayPDF.Setup.csproj') + $common + @("-p:PayloadPath=$payload","-p:ReceiverPath=$receiverExe",'--output',$setup))
        Copy-Item -LiteralPath $payload -Destination (Join-Path $out 'DayDayPDF.exe') -Force
        Copy-Item -LiteralPath (Join-Path $setup 'DaydayPDF.Setup.exe') -Destination (Join-Path $out 'DayDayPDF.Setup.exe') -Force
        $hashes = foreach ($name in @('DayDayPDF.Setup.exe','DayDayPDF.exe')) {
            $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out $name)).Hash.ToLowerInvariant()
            "$hash  $name"
        }
        [IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS.txt'), ($hashes -join [char]10) + [char]10)
    } finally { Pop-Location }
} finally { Pop-Location }
