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

# Check GitHub connectivity for better-sqlite3 prebuilds
info "检测网络环境..."
if curl -fsSL --connect-timeout 5 "https://github.com" -o /dev/null 2>/dev/null; then
    ok "网络正常，使用在线模式安装"
    OFFLINE_MODE=false
else
    warn "无法访问 GitHub，切换到内网离线安装模式..."
    warn "better-sqlite3 将使用 prebuilds/ 目录中的预编译文件"
    OFFLINE_MODE=true
fi

# Install backend dependencies
info "安装后端依赖..."
if [ "$OFFLINE_MODE" = true ]; then
    npm install --ignore-scripts
    # Extract Linux prebuild if available
    ARCH=$(node -e "process.stdout.write(process.arch)")
    ABI=$(node -e "process.stdout.write(process.versions.modules)")
    PREBUILD="prebuilds/better-sqlite3/better-sqlite3-v12.10.0-node-v${ABI}-linux-${ARCH}.tar.gz"
    if [ -f "$PREBUILD" ]; then
        mkdir -p node_modules/better-sqlite3/build/Release
        tar -xzf "$PREBUILD" -C node_modules/better-sqlite3
        ok "better-sqlite3 预编译文件安装完成 ($ARCH)"
    else
        warn "未找到 Linux 平台预编译文件 ($PREBUILD)，尝试从源码编译..."
        (cd node_modules/better-sqlite3 && npm run build-release) || \
            warn "编译失败，运行时可能出现问题。请参阅 docs/offline-install.md"
    fi
else
    npm install
fi
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
