@echo off
rem Prototype.exe 다시 만들기 (Windows 기본 C# 컴파일러 사용)
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo C# 컴파일러를 찾을 수 없어요: %CSC%
  pause
  exit /b 1
)
set W=launcher\webview2
"%CSC%" /nologo /target:winexe /codepage:65001 /optimize+ /out:Prototype.exe /win32icon:launcher\app.ico /r:System.Windows.Forms.dll /r:System.Management.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:%W%\Microsoft.Web.WebView2.Core.dll /r:%W%\Microsoft.Web.WebView2.WinForms.dll "/resource:%W%\Microsoft.Web.WebView2.Core.dll,wv2.Core.dll" "/resource:%W%\Microsoft.Web.WebView2.WinForms.dll,wv2.WinForms.dll" "/resource:%W%\WebView2Loader.x64.dll,wv2.loader.x64.dll" "/resource:%W%\WebView2Loader.x86.dll,wv2.loader.x86.dll" "/resource:%W%\WebView2Loader.arm64.dll,wv2.loader.arm64.dll" launcher\Launcher.cs launcher\AppWindow.cs
if errorlevel 1 (
  echo 빌드 실패
  pause
  exit /b 1
)
echo 완료: Prototype.exe
pause