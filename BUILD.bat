@echo off
rem Prototype.exe 다시 만들기 (Windows 기본 C# 컴파일러 사용)
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo C# 컴파일러를 찾을 수 없어요: %CSC%
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /codepage:65001 /optimize+ /out:Prototype.exe /win32icon:launcher\app.ico /r:System.Windows.Forms.dll /r:System.Management.dll launcher\Launcher.cs
if errorlevel 1 (
  echo 빌드 실패
  pause
  exit /b 1
)
echo 완료: Prototype.exe
pause