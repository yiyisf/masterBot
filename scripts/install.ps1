# CMaster Bot — 一键安装脚本 (Windows PowerShell)
$ErrorActionPreference = "Stop"

function Write-Info  { param([string]$msg) Write-Host "▶ $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "✔ $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Die   { param([string]$msg) Write-Host "✘ $msg" -ForegroundColor Red; exit 1 }

Write-Host @"
  ██████╗███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗
 ██╔════╝████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
 ██║     ██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝
 ██║     ██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗
 ╚██████╗██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║
  ╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
                   Enterprise AI Assistant
"@ -ForegroundColor Magenta

# Check Node.js
Write-Info "检查 Node.js 版本..."
try {
    $nodeVer = (node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Die "Node.js 版本过低 (当前: v$nodeVer)，需要 >= 22。`n  请从 https://nodejs.org 下载 Node.js 22 LTS"
    }
    Write-Ok "Node.js v$nodeVer ✓"
} catch {
    Write-Die "未找到 Node.js。请从 https://nodejs.org 安装 Node.js 22 LTS"
}

# Install backend dependencies
Write-Info "安装后端依赖..."
npm install
Write-Ok "后端依赖安装完成"

# Install frontend dependencies
Write-Info "安装前端依赖..."
Set-Location web
npm install
Set-Location ..
Write-Ok "前端依赖安装完成"

# Configure .env
if (-not (Test-Path ".env")) {
    Write-Info "创建 .env 配置文件..."
    @"
# LLM 配置 (必填)
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# 日志级别 (可选: debug/info/warn/error)
LOG_LEVEL=info
"@ | Out-File -FilePath ".env" -Encoding UTF8

    Write-Host ""
    Write-Host "请编辑 .env 文件填入您的 API Key 和 Base URL" -ForegroundColor Yellow
    $openEnv = Read-Host "现在打开 .env 文件编辑？[Y/n]"
    if ($openEnv -eq "" -or $openEnv -eq "Y" -or $openEnv -eq "y") {
        notepad.exe .env
    }
} else {
    Write-Ok ".env 文件已存在，跳过配置"
}

Write-Host ""
Write-Host "╔═══════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   CMaster Bot 安装成功！          ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "启动方式："
Write-Host "  全栈开发模式  →  在两个终端分别运行:" -ForegroundColor White
Write-Host "    1. npm run dev          (后端，端口 3000)" -ForegroundColor Cyan
Write-Host "    2. cd web; npm run dev  (前端，端口 3001)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Docker 部署   →  docker compose up -d" -ForegroundColor Cyan
Write-Host ""
Write-Host "访问地址: http://localhost:3000" -ForegroundColor White
Write-Host ""
