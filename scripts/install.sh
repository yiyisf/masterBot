#!/usr/bin/env bash
set -euo pipefail

# ╔══════════════════════════════════════════════════════╗
# ║         CMaster Bot — 一键安装脚本 (macOS/Linux)     ║
# ╚══════════════════════════════════════════════════════╝

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()  { echo -e "${CYAN}▶ $*${RESET}"; }
ok()    { echo -e "${GREEN}✔ $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()   { echo -e "${RED}✘ $*${RESET}"; exit 1; }

echo -e "${BOLD}"
cat <<'EOF'
  ██████╗███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗
 ██╔════╝████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
 ██║     ██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝
 ██║     ██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗
 ╚██████╗██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║
  ╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
                   Enterprise AI Assistant
EOF
echo -e "${RESET}"

# Check Node.js >= 22
info "检查 Node.js 版本..."
if ! command -v node &> /dev/null; then
    die "未找到 Node.js。请先安装 Node.js 22+：https://nodejs.org\n  或使用 nvm: nvm install 22 && nvm use 22"
fi

NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_VER" -lt 22 ]; then
    die "Node.js 版本过低 (当前: v$(node --version | tr -d 'v'))，需要 >= 22。\n  使用 nvm: nvm install 22 && nvm use 22"
fi
ok "Node.js $(node --version) ✓"

# Install backend dependencies
info "安装后端依赖..."
npm install
ok "后端依赖安装完成"

# Install frontend dependencies
info "安装前端依赖..."
(cd web && npm install)
ok "前端依赖安装完成"

# Configure .env
if [ ! -f .env ]; then
    info "配置环境变量..."
    cat > .env << 'ENVTEMPLATE'
# LLM 配置 (必填)
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# 日志级别 (可选: debug/info/warn/error)
LOG_LEVEL=info
ENVTEMPLATE

    echo ""
    echo -e "${YELLOW}请编辑 .env 文件填入您的 API Key 和 Base URL：${RESET}"
    echo -e "  ${BOLD}OPENAI_API_KEY${RESET}  = 您的 LLM API 密钥"
    echo -e "  ${BOLD}OPENAI_BASE_URL${RESET} = API 地址 (支持 OpenAI/Azure/本地部署)"
    echo ""
    read -p "现在打开 .env 文件编辑？[Y/n] " OPEN_ENV
    if [[ "${OPEN_ENV:-Y}" =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    fi
else
    ok ".env 文件已存在，跳过配置"
fi

echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════╗"
echo -e "║   CMaster Bot 安装成功！          ║"
echo -e "╚═══════════════════════════════════╝${RESET}"
echo ""
echo -e "启动方式："
echo -e "  ${BOLD}全栈开发模式${RESET}  →  在两个终端分别运行:"
echo -e "    1. ${CYAN}npm run dev${RESET}          (后端，端口 3000)"
echo -e "    2. ${CYAN}cd web && npm run dev${RESET} (前端，端口 3001)"
echo ""
echo -e "  ${BOLD}生产模式${RESET}      →  ${CYAN}npm run build && npm start${RESET}"
echo -e "  ${BOLD}Docker 部署${RESET}   →  ${CYAN}docker compose up -d${RESET}"
echo ""
echo -e "访问地址: ${BOLD}http://localhost:3000${RESET}"
echo ""
