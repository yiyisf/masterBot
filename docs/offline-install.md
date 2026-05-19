# CMaster Bot — 内网离线安装指南（Windows）

本文档面向无法直接访问 GitHub 的内网环境，说明如何在 Windows 上完成
`better-sqlite3` 原生模块的离线安装，以及完整的项目部署流程。

---

## 背景说明

`better-sqlite3` 是一个包含 C++ 原生扩展的 npm 包。安装时，其 `postinstall`
脚本会通过 `prebuild-install` 工具尝试从 GitHub Releases 下载预编译的二进制文件
（`.node` 文件）。在内网环境中，该下载请求会失败，导致安装中断。

**下载失败时的错误信息示例：**
```
prebuild-install warn install No prebuilt binaries found
gyp info spawn args    '-Dnode_root_dir=...'
gyp ERR! build error
```

---

## 平台支持说明

| Windows 版本 | 架构 | Node.js 22 支持 | 预编译文件 |
|-------------|------|:--------------:|:----------:|
| Windows 10/11 | x64（64位） | ✅ | 已内置 |
| Windows 11 | ARM64 | ✅ | 已内置 |
| Windows 7/8/10 | x86（32位） | ❌ | 不适用 |

> **重要：Windows x86 32位系统不受支持**
>
> Node.js 官方自 v19 起已停止对 Windows 32 位（x86/ia32）的支持。
> 本项目要求 Node.js >= 22，因此**不能在 32 位 Windows 系统上运行**。
>
> 如果您的业务场景必须支持 32 位 Windows，请参阅文档末尾的
> [替代方案](#替代方案32位-windows)。

---

## 前置要求

在开始安装前，请确认以下工具已在 Windows 机器上安装：

- **Node.js 22 LTS**（64位版本）
  - 下载地址：`https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi`
  - 验证：`node --version` 应输出 `v22.x.x`
- **Git**（用于获取项目代码）
  - 或直接下载项目压缩包并解压
- **Windows PowerShell 5.1+** 或 **PowerShell 7+**
  - 验证：在 PowerShell 中运行 `$PSVersionTable.PSVersion`

---

## 离线安装步骤

### 方法一：使用自动化脚本（推荐）

项目提供了专用的离线安装脚本，会自动完成以下所有步骤。

在项目根目录打开 **命令提示符（CMD）** 或 **PowerShell**，运行：

```bat
scripts\install-offline.bat
```

或直接使用 PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\install-offline.ps1
```

---

### 方法二：手动安装

如果自动脚本无法运行，可按以下步骤手动完成安装。

#### 第 1 步：安装 npm 依赖（跳过原生模块编译）

```bat
npm install --ignore-scripts
cd web && npm install && cd ..
```

`--ignore-scripts` 标志会跳过所有 `postinstall` 脚本，包括
`better-sqlite3` 的预编译文件下载步骤。

#### 第 2 步：确认预编译文件存在

检查项目根目录下是否有以下文件（已随代码库一起提供）：

```
prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v127-win32-x64.tar.gz
prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v127-win32-arm64.tar.gz
```

如果文件缺失，请参阅[如何获取预编译文件](#如何获取预编译文件)。

#### 第 3 步：确认目标架构

在 PowerShell 中运行以下命令，确认当前系统架构：

```powershell
node -e "console.log(process.arch)"
# 输出 x64 或 arm64
```

#### 第 4 步：提取原生模块

根据上一步的输出，在 PowerShell 中运行对应命令：

**x64 系统：**
```powershell
New-Item -ItemType Directory -Force -Path "node_modules\better-sqlite3\build\Release"
tar -xzf "prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v127-win32-x64.tar.gz" `
    -C "node_modules\better-sqlite3"
```

**ARM64 系统：**
```powershell
New-Item -ItemType Directory -Force -Path "node_modules\better-sqlite3\build\Release"
tar -xzf "prebuilds\better-sqlite3\better-sqlite3-v12.10.0-node-v127-win32-arm64.tar.gz" `
    -C "node_modules\better-sqlite3"
```

> `tar` 命令在 Windows 10 1803+ 版本中内置可用。如果提示未找到命令，
> 请安装 [Git for Windows](https://git-scm.com/download/win)，使用其附带的 tar 工具。

#### 第 5 步：验证安装

```powershell
node -e "const db = require('better-sqlite3')(':memory:'); console.log('better-sqlite3 安装成功，版本：', db.pragma('user_version')[0])"
```

如果输出 `better-sqlite3 安装成功` 则表示安装正常。

#### 第 6 步：配置环境变量

复制环境变量模板并填写配置：

```bat
copy .env.example .env
notepad .env
```

必须填写的配置项：

```env
# LLM API 配置（必填）
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://your-internal-llm-api/v1
```

#### 第 7 步：构建并启动

```bat
REM 开发模式（两个命令行窗口分别运行）
npm run dev
cd web && npm run dev

REM 或生产模式
npm run build
npm start
```

---

## 如何获取预编译文件

预编译文件已包含在代码库的 `prebuilds/better-sqlite3/` 目录中。
如需从有网络访问权限的机器重新下载，可使用以下命令：

```powershell
# 在有互联网访问的机器上执行
$version = "12.10.0"
$abi = "127"  # Node.js 22.x 对应的 ABI 版本
$baseUrl = "https://github.com/WiseLibs/better-sqlite3/releases/download/v$version"

# Windows x64（推荐，适用于大多数 Windows 10/11 系统）
Invoke-WebRequest `
    "$baseUrl/better-sqlite3-v$version-node-v$abi-win32-x64.tar.gz" `
    -OutFile "prebuilds\better-sqlite3\better-sqlite3-v$version-node-v$abi-win32-x64.tar.gz"

# Windows ARM64（适用于 Surface Pro X / ARM 版 Windows 11）
Invoke-WebRequest `
    "$baseUrl/better-sqlite3-v$version-node-v$abi-win32-arm64.tar.gz" `
    -OutFile "prebuilds\better-sqlite3\better-sqlite3-v$version-node-v$abi-win32-arm64.tar.gz"
```

### 预编译文件命名规则

```
better-sqlite3-v{版本}-{运行时}-v{ABI版本}-{平台}-{架构}.tar.gz
```

| 字段 | 说明 | 本项目取值 |
|------|------|-----------|
| 版本 | better-sqlite3 的语义版本号 | `12.10.0` |
| 运行时 | `node`（Node.js）或 `electron` | `node` |
| ABI版本 | Node.js 模块 ABI 版本号 | `127`（Node.js 22.x） |
| 平台 | 操作系统标识 | `win32`（Windows） |
| 架构 | CPU 架构 | `x64` 或 `arm64` |

### Node.js 版本与 ABI 对照表

| Node.js 版本 | ABI 版本 | 状态 |
|-------------|---------|------|
| 22.x LTS | 127 | ✅ 推荐（本项目使用） |
| 23.x | 131 | ✅ 可用 |
| 24.x | 137 | ✅ 可用 |
| 18.x LTS | 108 | ⚠ 不符合项目要求 |

---

## 从源码编译（备选方案）

如果预编译文件无法使用（例如 Node.js 版本不匹配），可以在本地从源码编译
`better-sqlite3`。此方法需要安装 Visual Studio 构建工具。

### 安装构建工具

```powershell
# 方法一：使用 npm 自动安装（推荐，约 800 MB）
npm install --global --production windows-build-tools

# 方法二：手动安装 Visual Studio Build Tools
# 下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 安装时勾选：C++ build tools + Windows 10 SDK
```

### 从源码重新编译

```powershell
# 安装所有依赖（允许运行 postinstall 脚本）
npm install

# 如果 prebuild-install 下载失败，强制从源码编译
cd node_modules\better-sqlite3
npm run build-release
cd ..\..
```

---

## 替代方案：32位 Windows

如果您的部署环境**必须**使用 Windows 32 位（x86），当前项目架构不支持该场景。
可考虑以下替代方案：

### 方案一：Docker 容器（推荐）

在 64 位 Windows 服务器上运行 Docker 容器，通过网络为 32 位客户端提供服务：

```bat
docker compose up -d
REM 访问地址：http://服务器IP:3000
```

容器内使用 64 位 Linux 环境，与客户端位数无关。

### 方案二：独立服务器部署

将 CMaster Bot 部署在任意支持 Node.js 22 的 64 位服务器上，32 位 Windows
客户端通过浏览器访问 Web 界面，无需在本地安装 Node.js。

---

## 常见问题

**Q：运行时提示 `Error: The specified module could not be found`**

A：`.node` 文件缺少 Visual C++ 运行库依赖。请安装
[Visual C++ Redistributable for Visual Studio 2019](https://aka.ms/vs/16/release/vc_redist.x64.exe)。

---

**Q：`node --version` 显示正确，但仍然提示 ABI 版本不匹配**

A：可能安装了多个 Node.js 版本。检查当前使用的版本：

```powershell
where.exe node
node -e "console.log(process.versions.modules)"  # 应输出 127
```

确认输出路径是 Node.js 22 的安装位置。

---

**Q：`tar` 命令提示"不是内部或外部命令"**

A：您的 Windows 版本较旧，不内置 `tar`。安装 Git for Windows 后，
使用 Git Bash 执行提取命令，或手动用 7-Zip 解压 `.tar.gz` 文件，
然后将 `build/Release/better_sqlite3.node` 复制到
`node_modules\better-sqlite3\build\Release\` 目录。

---

**Q：安装后运行时提示 FTS5 不可用，全文搜索降级**

A：这是已知的降级行为，不影响核心功能。better-sqlite3 的 SQLite 编译选项中
FTS5 是默认启用的，如果提示不可用，通常说明使用了非官方编译的 SQLite。
使用本文档提供的预编译文件可以避免此问题。

---

*文档版本：v3-p10 | 适用于 better-sqlite3 v12.10.0 + Node.js 22.x*
