@echo off
setlocal
cd /d "%~dp0"
if not defined WA824_PORT set "WA824_PORT=8001"

REM Add the standard MSYS2 UCRT64 installation to this process only.
if exist "C:\msys64\ucrt64\bin\iverilog.exe" set "PATH=C:\msys64\ucrt64\bin;%PATH%"
if exist "C:\msys64\ucrt64\bin\g++.exe" set "PATH=C:\msys64\ucrt64\bin;%PATH%"

where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_CMD=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Python 3.10+ is required. See docs\INSTALL-WINDOWS.ko-KR.md
    pause
    exit /b 1
  )
  set "PYTHON_CMD=python"
)

%PYTHON_CMD% -c "import pycparser" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python package pycparser is missing.
  echo Install: %PYTHON_CMD% -m pip install -r requirements.txt
  pause
  exit /b 1
)
where iverilog >nul 2>nul
if errorlevel 1 echo [INFO] Icarus Verilog not found. JS reference CPU is available.

echo Starting WA824 Visualizer at http://localhost:%WA824_PORT%
start "" "http://localhost:%WA824_PORT%"
%PYTHON_CMD% backend\server.py
if errorlevel 1 (
  echo [ERROR] Server exited with an error. Another process may be using port %WA824_PORT%.
  pause
  exit /b 1
)
endlocal
