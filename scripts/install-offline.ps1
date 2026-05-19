# CMaster Bot — Windows 内网离线安装脚本
# 适用场景：无法访问 GitHub 的内网环境
# 使用方法：在项目根目录运行  .\scripts\install-offline.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)  # 确保在项目根目录运行

function Write-Info { param([string]$msg) Write-Host "▶ $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "✔ $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Die  { param([string]$msg) Write-Host "✘ $msg" -ForegroundColor Red; exit 1 }

Write-Host @"
  ██████╗███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗
 ██╔════╝████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
 ██║     ██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝
 ██║     ██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗
 ╚██████╗██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║
  ╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
              Enterprise AI Assistant  [内网离线安装模式]
"@ -ForegroundColor Magenta

# ─── 1. 检查 Node.js ───────────────────────────────────────────────────────────

Write-Info "检查 Node.js 版本..."
try {
    $nodeVer = (node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Die "Node.js 版本过低 (当前: v$nodeVer)，需要 >= 22 (64位)。`n  下载地址：https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi"
    }
    $nodeArch = node -e "process.stdout.write(process.arch)"
    if ($nodeArch -eq "ia32") {
        Write-Die "检测到 32 位 Node.js (x86)。`n  本项目不支持 Windows 32 位环境，请安装 64 位 Node.js 22 LTS。`n  下载地址：https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi`n  详细说明：docs\offline-install.md"
    }
    Write-Ok "Node.js v$nodeVer ($nodeArch) ✓"
} catch {
    Write-Die "未找到 Node.js。请安装 Node.js 22 LTS (64位)：https://nodejs.org"
}

# ─── 2. 确认系统架构 ────────────────────────────────────────────────────────────

$arch = node -e "process.stdout.write(process.arch)"
$nodeAbi = node -e "process.stdout.write(process.versions.modules)"

Write-Info "系统架构：$arch | Node.js ABI：$nodeAbi"

$prebuildFile = "prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v$nodeAbi-win32-$arch.tar.gz"

if (-not (Test-Path $prebuildFile)) {
    Write-Warn "未找到对应的预编译文件：$prebuildFile"
    Write-Warn "可用的预编译文件："
    Get-ChildItem "prebuilds\better-sqlite3\*.tar.gz" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "    $($_.Name)" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "请从有网络的机器下载对应文件后放入 prebuilds\better-sqlite3\ 目录。" -ForegroundColor Yellow
    Write-Host "详细说明：docs\offline-install.md" -ForegroundColor Yellow

    $buildFromSource = Read-Host "是否尝试从源码编译（需要 Visual Studio 构建工具）？[y/N]"
    if ($buildFromSource -ne "y" -and $buildFromSource -ne "Y") {
        Write-Die "安装中止。请准备好预编译文件后重新运行本脚本。"
    }
    $BUILD_FROM_SOURCE = $true
} else {
    Write-Ok "找到预编译文件：$prebuildFile"
    $BUILD_FROM_SOURCE = $false
}

# ─── 3. 安装后端 npm 依赖（跳过 postinstall 脚本）─────────────────────────────

Write-Info "安装后端依赖（--ignore-scripts 模式，跳过 GitHub 下载）..."
npm install --ignore-scripts
Write-Ok "后端依赖安装完成"

# ─── 4. 安装 better-sqlite3 原生模块 ───────────────────────────────────────────

if ($BUILD_FROM_SOURCE) {
    Write-Info "从源码编译 better-sqlite3..."
    Push-Location "node_modules\better-sqlite3"
    try {
        npm run build-release
        Write-Ok "better-sqlite3 编译成功"
    } catch {
        Pop-Location
        Write-Die "编译失败。请确认已安装 Visual Studio Build Tools (C++)。`n  安装命令：npm install -g windows-build-tools"
    }
    Pop-Location
} else {
    Write-Info "安装 better-sqlite3 预编译文件..."

    # 创建目标目录
    $targetDir = "node_modules\better-sqlite3"
    New-Item -ItemType Directory -Force -Path "$targetDir\build\Release" | Out-Null

    # 检查 tar 是否可用
    $tarAvailable = $null -ne (Get-Command tar -ErrorAction SilentlyContinue)
    if (-not $tarAvailable) {
        Write-Die "未找到 tar 命令。`n  请安装 Git for Windows (包含 tar 工具)：https://git-scm.com/download/win`n  或手动解压预编译文件，参阅：docs\offline-install.md"
    }

    tar -xzf $prebuildFile -C $targetDir
    if ($LASTEXITCODE -ne 0) {
        Write-Die "预编译文件提取失败。请确认文件完整性后重试。"
    }
    Write-Ok "better-sqlite3 预编译文件安装成功（$arch）"
}

# ─── 5. 运行其余 postinstall 脚本（排除 better-sqlite3）──────────────────────

Write-Info "运行其他模块的初始化脚本..."
# 仅为不依赖外网的包运行 install 脚本（如 esbuild、sharp 等）
$otherNativeModules = @("esbuild", "@rollup/rollup-win32-x64-msvc")
foreach ($mod in $otherNativeModules) {
    $modPath = "node_modules\$mod"
    if (Test-Path "$modPath\package.json") {
        $pkg = Get-Content "$modPath\package.json" | ConvertFrom-Json
        if ($pkg.scripts.install) {
            Push-Location $modPath
            npm run install 2>$null
            Pop-Location
        }
    }
}

# ─── 6. 安装前端依赖 ────────────────────────────────────────────────────────────

Write-Info "安装前端依赖..."
Push-Location web
npm install --ignore-scripts
Pop-Location
Write-Ok "前端依赖安装完成"

# ─── 7. 验证 better-sqlite3 ────────────────────────────────────────────────────

Write-Info "验证 better-sqlite3 安装..."
$testResult = node -e "
try {
  const db = require('better-sqlite3')(':memory:');
  const fts5 = db.prepare(\"SELECT fts5(?1)\").get('test') !== undefined;
  console.log('OK');
} catch(e) {
  console.error(e.message);
  process.exit(1);
}
" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Warn "better-sqlite3 验证出现问题：$testResult"
    Write-Warn "请参阅 docs\offline-install.md 中的常见问题排查。"
} else {
    Write-Ok "better-sqlite3 运行正常"
}

# ─── 8. 配置 .env ──────────────────────────────────────────────────────────────

if (-not (Test-Path ".env")) {
    Write-Info "创建 .env 配置文件..."
    @"
# LLM 配置（必填）
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# 日志级别（可选：debug/info/warn/error）
LOG_LEVEL=info
"@ | Out-File -FilePath ".env" -Encoding UTF8

    Write-Host ""
    Write-Host "请编辑 .env 文件，填入 LLM API 密钥和接口地址。" -ForegroundColor Yellow
    $openEnv = Read-Host "现在打开 .env 文件编辑？[Y/n]"
    if ($openEnv -eq "" -or $openEnv -ieq "y") {
        Start-Process notepad.exe ".env"
    }
} else {
    Write-Ok ".env 文件已存在，跳过配置"
}

# ─── 完成 ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   CMaster Bot 离线安装成功！             ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "启动方式（在两个 PowerShell 窗口分别运行）："
Write-Host "  1. npm run dev          " -NoNewline; Write-Host "(后端，端口 3000)" -ForegroundColor Cyan
Write-Host "  2. cd web; npm run dev  " -NoNewline; Write-Host "(前端，端口 3001)" -ForegroundColor Cyan
Write-Host ""
Write-Host "访问地址：http://localhost:3000" -ForegroundColor White
Write-Host ""
