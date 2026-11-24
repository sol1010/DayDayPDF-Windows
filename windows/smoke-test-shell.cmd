@echo off
setlocal

if "%~1"=="" (
  echo Usage: smoke-test-shell.cmd "C:\path\file.pdf"
  exit /b 2
)

set "VSDEVCMD=C:\BuildTools\Common7\Tools\VsDevCmd.bat"
call "%VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%

set "PROJECT_ROOT=%~dp0"
set "OUTPUT_DIR=%PROJECT_ROOT%PdfEditor.Shell.Tests\bin"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

cl.exe /nologo /utf-8 /std:c++20 /permissive- /EHsc /W4 /O2 ^
  "%PROJECT_ROOT%PdfEditor.Shell.Tests\ExplorerCommandSmoke.cpp" ole32.lib shell32.lib ^
  /Fe:"%OUTPUT_DIR%\ExplorerCommandSmoke.exe"
if errorlevel 1 exit /b %errorlevel%

"%OUTPUT_DIR%\ExplorerCommandSmoke.exe" "%~1"
exit /b %errorlevel%
