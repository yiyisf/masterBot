@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo.
echo  CMaster Bot - Offline Installation (Intranet Mode)
echo  ===================================================
echo.

REM ---- 1. Check Node.js -------------------------------------------------------

echo [*] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js not found. Install Node.js 22 LTS (64-bit):
    echo     https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi
    goto :FAIL
)

node -e "process.exit(parseInt(process.version.slice(1)) < 22 ? 1 : 0)"
if errorlevel 1 (
    for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
    echo [X] Node.js version too old: !NODE_VER!  (required: >= 22, 64-bit)
    echo     https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi
    goto :FAIL
)

REM ---- 2. Detect architecture (write to temp file to avoid quote issues) ------

node -e "process.stdout.write(process.arch)"        > "%TEMP%\_cmaster_arch.tmp"
node -e "process.stdout.write(process.versions.modules)" > "%TEMP%\_cmaster_abi.tmp"
node --version                                      > "%TEMP%\_cmaster_ver.tmp"

set /p ARCH=<"%TEMP%\_cmaster_arch.tmp"
set /p NODE_ABI=<"%TEMP%\_cmaster_abi.tmp"
set /p NODE_VER=<"%TEMP%\_cmaster_ver.tmp"

del "%TEMP%\_cmaster_arch.tmp" "%TEMP%\_cmaster_abi.tmp" "%TEMP%\_cmaster_ver.tmp" 2>nul

if "%ARCH%"=="ia32" (
    echo [X] 32-bit Node.js (x86) detected.
    echo     This project requires 64-bit Node.js 22. See docs\offline-install.md.
    goto :FAIL
)

echo [OK] Node.js %NODE_VER% (%ARCH%)

REM ---- 3. Locate prebuild file ------------------------------------------------

set PREBUILD=prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v%NODE_ABI%-win32-%ARCH%.tar.gz

echo [*] Arch: %ARCH%  /  Node ABI: %NODE_ABI%
echo [*] Prebuild: %PREBUILD%

if not exist "%PREBUILD%" (
    echo.
    echo [!] Prebuild file not found: %PREBUILD%
    echo     Available files in prebuilds\better-sqlite3\:
    dir /b "prebuilds\better-sqlite3\*.tar.gz" 2>nul || echo     (none)
    echo.
    echo     Please download the matching file and place it in prebuilds\better-sqlite3\
    echo     Instructions: docs\offline-install.md
    goto :FAIL
)

echo [OK] Prebuild file ready.

REM ---- 4. npm install (skip postinstall / GitHub download) --------------------

echo.
echo [*] Installing backend dependencies (--ignore-scripts)...
npm install --ignore-scripts
if errorlevel 1 (
    echo [X] npm install failed. Check npm config and try again.
    goto :FAIL
)
echo [OK] Backend dependencies installed.

REM ---- 5. Extract native module -----------------------------------------------

echo.
echo [*] Installing better-sqlite3 native module...

tar --version >nul 2>&1
if errorlevel 1 (
    echo [X] tar command not found.
    echo     Windows 10 1803+ includes tar. If missing, install Git for Windows:
    echo     https://git-scm.com/download/win
    echo     Alternatively, see manual extraction steps in docs\offline-install.md
    goto :FAIL
)

if not exist "node_modules\better-sqlite3\build\Release" (
    mkdir "node_modules\better-sqlite3\build\Release"
)

tar -xzf "%PREBUILD%" -C "node_modules\better-sqlite3"
if errorlevel 1 (
    echo [X] Failed to extract prebuild. File may be corrupted.
    goto :FAIL
)

echo [OK] better-sqlite3 native module installed (%ARCH%)

REM ---- 6. Verify --------------------------------------------------------------

echo.
echo [*] Verifying better-sqlite3...
node -e "require('better-sqlite3')(':memory:').close()" >nul 2>&1
if errorlevel 1 (
    echo [!] Verification failed. You may need the Visual C++ Runtime:
    echo     https://aka.ms/vs/16/release/vc_redist.x64.exe
    echo     See docs\offline-install.md for troubleshooting.
) else (
    echo [OK] better-sqlite3 verified OK.
)

REM ---- 7. Frontend dependencies -----------------------------------------------

echo.
echo [*] Installing frontend dependencies...
cd web
npm install --ignore-scripts
if errorlevel 1 (
    cd ..
    echo [X] Frontend npm install failed.
    goto :FAIL
)
cd ..
echo [OK] Frontend dependencies installed.

REM ---- 8. Configure .env ------------------------------------------------------

echo.
if not exist ".env" (
    echo [*] Creating .env file...
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
    ) else (
        echo # LLM Config (required)> ".env"
        echo OPENAI_API_KEY=your-api-key-here>> ".env"
        echo OPENAI_BASE_URL=https://api.openai.com/v1>> ".env"
        echo.>> ".env"
        echo # Log level: debug / info / warn / error>> ".env"
        echo LOG_LEVEL=info>> ".env"
    )
    echo.
    echo [!] Edit .env with your API key and base URL before starting.
    echo.
    set /p OPEN_ENV="    Open .env in Notepad now? [Y/n] "
    if /i "!OPEN_ENV!"==""  start notepad ".env"
    if /i "!OPEN_ENV!"=="y" start notepad ".env"
) else (
    echo [OK] .env already exists, skipping.
)

REM ---- Done -------------------------------------------------------------------

echo.
echo  ============================================
echo    CMaster Bot offline installation done!
echo  ============================================
echo.
echo  Start (run in two separate CMD windows):
echo    1. npm run dev            (backend,  port 3000)
echo    2. cd web ^&^& npm run dev  (frontend, port 3001)
echo.
echo  Open browser: http://localhost:3000
echo.
endlocal
exit /b 0

:FAIL
echo.
echo  [X] Installation failed. See docs\offline-install.md for help.
echo.
endlocal
exit /b 1
