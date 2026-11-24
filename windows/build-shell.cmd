@echo off
setlocal

set "VSDEVCMD=C:\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" (
  echo Visual Studio C++ Build Tools not found: %VSDEVCMD%
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%

set "PROJECT_ROOT=%~dp0"
set "SOURCE_DIR=%PROJECT_ROOT%PdfEditor.Shell"
set "OUTPUT_DIR=%SOURCE_DIR%\bin\Release"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

pushd "%OUTPUT_DIR%"
cl.exe /nologo /utf-8 /std:c++20 /permissive- /EHsc /W4 /O2 /GL ^
  /DUNICODE /D_UNICODE /LD "%SOURCE_DIR%\ExplorerCommands.cpp" ole32.lib ^
  /link /LTCG /DEF:"%SOURCE_DIR%\PdfEditor.Shell.def" /OUT:PdfEditor.Shell.dll
set "BUILD_EXIT=%ERRORLEVEL%"
popd

exit /b %BUILD_EXIT%
