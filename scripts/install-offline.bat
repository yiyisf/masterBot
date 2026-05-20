@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

echo.
echo   CCCCC  M   M  AAAAA  SSSSS TTTTT EEEEE RRRRR
echo   C      MM MM  A   A  S       T   E     R   R
echo   C      M M M  AAAAA  SSSSS   T   EEEE  RRRRR
echo   C      M   M  A   A      S   T   E     R  R
echo   CCCCC  M   M  A   A  SSSSS   T   EEEEE R   R
echo              Enterprise AI Assistant  [内网离线安装]
echo.

REM ─── 1. 检查 Node.js ──────────────────────────────────────────────────────

echo [*] 检查 Node.js 版本...
node --version >nul 2>&1
if errorlevel 1 (
    echo [X] 未找到 Node.js，请先安装 Node.js 22 LTS ^(64位^)
    echo     下载地址: https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi
    goto :FAIL
)

for /f %%v in ('node -e "process.stdout.write(String(parseInt(process.version.slice(1))))"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
    for /f %%v in ('node --version') do set NODE_VER=%%v
    echo [X] Node.js 版本过低 ^(当前: !NODE_VER!^)，需要 ^>= 22 ^(64位^)
    echo     下载地址: https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi
    goto :FAIL
)

REM ─── 2. 检查系统架构 ───────────────────────────────────────────────────────

for /f %%a in ('node -e "process.stdout.write(process.arch)"') do set ARCH=%%a
for /f %%v in ('node --version') do set NODE_VER=%%v

if "%ARCH%"=="ia32" (
    echo [X] 检测到 32 位 Node.js ^(x86^)
    echo     本项目不支持 Windows 32 位环境，请安装 64 位 Node.js 22 LTS
    echo     下载地址: https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi
    echo     替代方案请参阅: docs\offline-install.md
    goto :FAIL
)
echo [√] Node.js %NODE_VER% ^(%ARCH%^)

REM ─── 3. 定位预编译文件 ─────────────────────────────────────────────────────

for /f %%v in ('node -e "process.stdout.write(process.versions.modules)"') do set NODE_ABI=%%v
set PREBUILD=prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v%NODE_ABI%-win32-%ARCH%.tar.gz

echo [*] 架构: %ARCH%  ^|  Node.js ABI: %NODE_ABI%
echo [*] 预编译文件: %PREBUILD%

if not exist "%PREBUILD%" (
    echo.
    echo [!] 未找到对应预编译文件: %PREBUILD%
    echo     prebuilds\better-sqlite3\ 目录中已有:
    dir /b "prebuilds\better-sqlite3\*.tar.gz" 2>nul || echo     ^(空^)
    echo.
    echo     请从可访问外网的机器下载后放入 prebuilds\better-sqlite3\ 目录
    echo     下载说明: docs\offline-install.md
    goto :FAIL
)
echo [√] 预编译文件已就绪

REM ─── 4. 安装后端依赖（跳过 postinstall 脚本）──────────────────────────────

echo.
echo [*] 安装后端依赖 ^(--ignore-scripts，跳过 GitHub 下载^)...
npm install --ignore-scripts
if errorlevel 1 (
    echo [X] 后端依赖安装失败，请检查 npm 配置
    goto :FAIL
)
echo [√] 后端依赖安装完成

REM ─── 5. 提取 better-sqlite3 原生模块 ──────────────────────────────────────

echo.
echo [*] 安装 better-sqlite3 预编译文件...

tar --version >nul 2>&1
if errorlevel 1 (
    echo [X] 未找到 tar 命令
    echo     Windows 10 1803+ 内置 tar；如提示不存在请安装 Git for Windows
    echo     下载地址: https://git-scm.com/download/win
    echo     或手动解压说明: docs\offline-install.md
    goto :FAIL
)

if not exist "node_modules\better-sqlite3\build\Release" (
    mkdir "node_modules\better-sqlite3\build\Release"
)

tar -xzf "%PREBUILD%" -C "node_modules\better-sqlite3"
if errorlevel 1 (
    echo [X] 预编译文件提取失败，请确认文件完整性后重试
    goto :FAIL
)
echo [√] better-sqlite3 原生模块安装成功 ^(%ARCH%^)

REM ─── 6. 验证 better-sqlite3 ────────────────────────────────────────────────

echo.
echo [*] 验证 better-sqlite3...
node -e "require('better-sqlite3')(':memory:').close(); process.exit(0)" >nul 2>&1
if errorlevel 1 (
    echo [!] 验证异常，可能缺少 Visual C++ 运行库
    echo     请安装: https://aka.ms/vs/16/release/vc_redist.x64.exe
    echo     排查说明: docs\offline-install.md
) else (
    echo [√] better-sqlite3 运行正常
)

REM ─── 7. 安装前端依赖 ───────────────────────────────────────────────────────

echo.
echo [*] 安装前端依赖...
cd web
npm install --ignore-scripts
if errorlevel 1 (
    cd ..
    echo [X] 前端依赖安装失败
    goto :FAIL
)
cd ..
echo [√] 前端依赖安装完成

REM ─── 8. 配置 .env ──────────────────────────────────────────────────────────

echo.
if not exist ".env" (
    echo [*] 创建 .env 配置文件...
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
    ) else (
        (
            echo # LLM 配置（必填）
            echo OPENAI_API_KEY=your-api-key-here
            echo OPENAI_BASE_URL=https://api.openai.com/v1
            echo.
            echo # 日志级别（可选：debug/info/warn/error）
            echo LOG_LEVEL=info
        ) > ".env"
    )
    echo.
    echo [!] 请编辑 .env 文件，填入 LLM API 密钥和接口地址:
    echo     OPENAI_API_KEY  = 您的 LLM API 密钥
    echo     OPENAI_BASE_URL = 内网 API 地址（兼容 OpenAI 格式）
    echo.
    set /p OPEN_ENV="    现在用记事本打开 .env 文件？[Y/n] "
    if /i "!OPEN_ENV!"=="" start notepad .env
    if /i "!OPEN_ENV!"=="y" start notepad .env
    if /i "!OPEN_ENV!"=="Y" start notepad .env
) else (
    echo [√] .env 文件已存在，跳过
)

REM ─── 完成 ──────────────────────────────────────────────────────────────────

echo.
echo  ============================================
echo    CMaster Bot 离线安装成功！
echo  ============================================
echo.
echo  启动方式（在两个 CMD 窗口分别运行）：
echo    1. npm run dev            （后端，端口 3000）
echo    2. cd web ^&^& npm run dev  （前端，端口 3001）
echo.
echo  访问地址：http://localhost:3000
echo.
endlocal
exit /b 0

:FAIL
echo.
echo  [X] 安装失败，请根据上方提示处理后重试
echo      详细说明：docs\offline-install.md
echo.
endlocal
exit /b 1
