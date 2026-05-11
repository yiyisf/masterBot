# masterBot 优化方案 · v3.1 增量补充

## Web-First 演进 · 跨平台兼容 · UI/UX 设计升级

---

**版本**：v3.1（v3.0 增量补充，**不替代** v3.0）
**日期**：2026 年 5 月 8 日
**适用范围**：本文档为 v3.0 最终版的**三处关键修订**，请配合 v3.0 完整方案使用
**核心修订**：
1. **Web 版优先**：先做 Web 版上线，Electron 桌面化推迟到后期
2. **跨平台兼容**：macOS 与 Windows 双端支持，Windows 内网零依赖
3. **UI/UX 升级**：基于 2026 年最佳实践，对整体界面做系统性优化

---

## 文档结构

```
第一部分  修订总览（What changed）
  · 第 1 章  三处关键修订与影响分析
  · 第 2 章  v3.0 → v3.1 演进路线对比

第二部分  跨平台兼容（OS Compatibility）
  · 第 3 章  macOS / Windows 双端策略
  · 第 4 章  Windows 内网零依赖设计

第三部分  Web-First 优先策略（Web First）
  · 第 5 章  为什么 Web 优先
  · 第 6 章  Web 版的能力边界与降级方案
  · 第 7 章  Web → Electron 平滑过渡设计

第四部分  UI/UX 设计优化（Design Upgrade）
  · 第 8 章  设计原则与设计系统
  · 第 9 章  核心界面重设计
  · 第 10 章 关键交互模式
  · 第 11 章 可访问性与国际化

第五部分  实施计划修订（Roadmap Revised）
  · 第 12 章 修订后的 16 阶段路线图
  · 第 13 章 关键里程碑变化

附录
  · 附录 A  Windows 内网部署清单
  · 附录 B  Web vs Electron 能力对照表
  · 附录 C  设计 Token 规范
  · 附录 D  组件清单
```

---

# 第一部分 修订总览

## 第 1 章 三处关键修订与影响分析

### 1.1 修订项概览

| 修订项 | 原方案（v3.0） | 新方案（v3.1） | 影响 |
|--------|---------------|---------------|------|
| **修订 1：演进顺序** | Phase 顺序未明确区分 Web/Desktop | **明确 Web 优先（P10）→ Electron 后置（P14）** | 路线图重排 |
| **修订 2：跨平台** | 主要考虑 macOS | **macOS + Windows 等优先级，Windows 零依赖** | 技术选型调整 |
| **修订 3：UI/UX** | 未单独章节讨论 | **新增完整设计系统 + 重设计** | 投入新增 2 周 |

### 1.2 三处修订之间的关系

这三处修订在工程上是**强相关**的，彼此互相支撑：

```
Web 优先 → 不需要桌面打包烦恼 → 跨平台天然解决
   ↓
   有更多时间打磨 UI/UX
   ↓
Web 版 UI 设计成熟后 → Electron 包装即可（P14）
   ↓
跨平台兼容（macOS+Windows）由浏览器原生支持
```

**核心洞察**：先 Web 后 Desktop 是**最低风险路径**——Web 版上线意味着员工可立即用，团队可在生产中迭代 UI/UX，最后再用 Electron 包装，几乎不需要"重新设计"。

### 1.3 对 v3.0 其他章节的影响

**保持不变的章节**：
- 第 1-3 章（战略定位、现状评估、设计原则）
- 第 4 章（10 层架构）
- 第 6 章（Hybrid Agent 引擎）
- 第 7 章（Skill Factory 双端协同）
- 第 9 章（企业身份与权限）
- 第 10 章（审计与合规）
- 第 11 章（网络与模型路由）

**需调整的章节**：
- 第 5 章 → 调整为"客户端形态演进"（Web 先行）
- 第 8 章 → 三轨升级在 Web 阶段简化为两轨
- 第 12 章 → 路线图重排（见本文档第 12 章）

---

## 第 2 章 v3.0 → v3.1 演进路线对比

### 2.1 路线图变化

```
v3.0 原路线（22 周）：
P0-P9 (Foundation + Engine + Enterprise)
  ↓
P9.5 Skill Factory 2.0
  ↓
P10 Electron 桌面打包（2 周）  ← 较早就做
  ↓
P11 三轨升级 → P12 灰度发布

v3.1 修订后路线（24 周）：
P0-P9 (Foundation + Engine + Enterprise)
  ↓
+ P9.7 UI/UX Design System（新增 2 周）
  ↓
P10 Web 版 MVP（替换原 Electron）
  ↓
P11 Web 版灰度发布上线 ← 更早交付价值
  ↓
P12 Web 版迭代运营
  ↓
P13 Electron 桌面化准备
  ↓
P14 Electron 打包（替代原 P10）
  ↓
P15 三轨升级（Electron 阶段）
  ↓
P16 桌面版灰度发布
```

### 2.2 时间投入对比

| 阶段 | v3.0 | v3.1 | 变化 |
|------|------|------|------|
| Foundation + Engine | 13 周 | 13 周 | 不变 |
| Skill Factory | 3 周 | 3 周 | 不变 |
| **UI/UX Design** | **0** | **+2 周** | **新增** |
| Web MVP | 0（隐含） | 2 周 | 新增显式 Phase |
| Web 上线运营 | 0 | 2 周 | 新增 |
| Electron 准备 | 0 | 1 周 | 新增 |
| Electron 打包 | 2 周 | 2 周 | 不变 |
| 三轨升级 | 3 周 | 3 周 | 不变 |
| 灰度发布 | 持续 | 持续 | 不变 |
| **总计** | **22 周** | **24 周** | **+2 周** |

只多 2 周，但获得：
- 更早交付价值（P11 后员工就能用 Web 版）
- 更扎实的 UI/UX 基础
- 更低的桌面化风险（在生产中验证过的设计）

### 2.3 价值交付时间提前

```
v3.0：员工 22 周后才用上 → 一次大爆发
v3.1：
  · 第 18 周：Web 版上线，员工开始用
  · 第 22 周：Web 版稳定迭代
  · 第 24 周：Electron 桌面版补齐
```

第一个有用版本提前 4 周，且团队有 6 周缓冲期来打磨桌面版。

---

# 第二部分 跨平台兼容

## 第 3 章 macOS / Windows 双端策略

### 3.1 双端兼容的两个层次

**Web 版阶段（P10-P12）**：
- 浏览器自然跨平台 → 零额外工作
- 仅需保证：Chrome/Edge/Safari 主流浏览器都能用
- 关键是测试 Windows 上的 Edge/Chrome、macOS 上的 Safari/Chrome

**Electron 阶段（P14-P16）**：
- 真正的跨平台挑战在这里
- 需要分别处理 macOS 与 Windows 的：构建、签名、分发、自动更新、文件路径、IPC

### 3.2 macOS 端策略

| 维度 | 策略 |
|------|------|
| **最低系统要求** | macOS 12 (Monterey) 及以上 |
| **架构支持** | Universal Binary（x64 + arm64） |
| **打包格式** | `.dmg`（首次）+ `.zip`（自动更新）|
| **代码签名** | Apple Developer ID 证书 |
| **公证** | 必须 Apple Notarization（Gatekeeper 不放行未公证应用） |
| **分发** | 公司内部 CDN 下载 + MDM 推送（Jamf/Mosyle） |
| **自动更新** | electron-updater + Squirrel.Mac 协议 |
| **Keychain** | 用 Electron `safeStorage` 加密 SSO token |

**关键代码示例**：

```yaml
# electron-builder.yml - macOS 部分
mac:
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize:
    teamId: "${APPLE_TEAM_ID}"
  target:
    - target: dmg
      arch: [universal]
    - target: zip
      arch: [universal]
```

### 3.3 Windows 端策略（核心难点）

Windows 是**企业内网部署的主战场**，但有许多坑：

| 维度 | 策略 |
|------|------|
| **最低系统要求** | Windows 10 1809 (RS5) 及以上 |
| **架构支持** | x64 优先，必要时 arm64 |
| **打包格式** | `.msi`（企业 SCCM 推送）+ `.exe`（个人下载） |
| **代码签名** | EV Code Signing 证书（避免 SmartScreen 警告） |
| **WebView2** | **首选已安装运行时**，缺失时 Bootstrapper 安装（详见第 4 章） |
| **分发** | 公司 SCCM / Intune / 内部下载页 |
| **自动更新** | electron-updater + NSIS 协议 |
| **凭据存储** | Electron `safeStorage` → DPAPI 加密 |

**关键代码示例**：

```yaml
# electron-builder.yml - Windows 部分
win:
  target:
    - target: nsis      # 个人安装包
      arch: [x64]
    - target: msi       # 企业 SCCM 推送
      arch: [x64]
  signingHashAlgorithms: ['sha256']
  certificateSubjectName: "ACME Corporation"  # EV 证书 Subject

nsis:
  oneClick: false               # 提供安装路径选择
  perMachine: false             # 默认安装到用户目录（无需管理员权限）
  allowElevation: true          # 但允许管理员安装
  allowToChangeInstallationDirectory: true
  installerLanguages: [en_US, zh_CN]

msi:
  oneClick: false
  perMachine: true              # MSI 默认 per-machine
  upgradeCode: '...uuid...'     # 必须保持稳定，否则升级失败
```

### 3.4 路径与文件系统差异处理

```typescript
// src/platform/paths.ts
import { app } from 'electron';
import path from 'path';

export class CrossPlatformPaths {
  /**
   * 用户数据目录
   * macOS: ~/Library/Application Support/masterBot
   * Windows: %APPDATA%\masterBot
   * Linux: ~/.config/masterBot（暂不支持）
   */
  static userData(): string {
    return app.getPath('userData');
  }

  /**
   * 缓存目录
   * macOS: ~/Library/Caches/masterBot
   * Windows: %LOCALAPPDATA%\masterBot\Cache
   */
  static cache(): string {
    return app.getPath('cache');
  }

  /**
   * 日志目录
   * macOS: ~/Library/Logs/masterBot
   * Windows: %LOCALAPPDATA%\masterBot\logs
   */
  static logs(): string {
    return app.getPath('logs');
  }

  /**
   * 跨平台路径连接（避免硬编码 / 或 \）
   */
  static join(...parts: string[]): string {
    return path.join(...parts);
  }

  /**
   * 跨平台环境变量名（Windows 不区分大小写）
   */
  static getEnv(name: string): string | undefined {
    return process.env[name] || process.env[name.toUpperCase()];
  }
}
```

### 3.5 IPC 与子进程差异

| 差异点 | macOS | Windows | 处理 |
|-------|-------|---------|------|
| 子进程启动 | bash / zsh | cmd / powershell | 用 `shell: false` + 显式参数数组 |
| 路径分隔符 | `/` | `\` | 永远用 `path.join()` |
| 文件权限 | 完整 POSIX | 简化（rwx 不严格） | 不依赖 chmod，逻辑层校验 |
| 文件锁定 | flock | LockFile | 用 `proper-lockfile` 库抽象 |
| 信号 | SIGTERM/SIGKILL 完整 | 仅 SIGINT/SIGTERM | 优雅降级 |

**子进程启动跨平台示例**：

```typescript
// src/mcp/process-manager.ts
import { spawn } from 'child_process';

const env = {
  ...process.env,
  HTTPS_PROXY: this.config.proxy,
  // Windows 必须保留 SystemRoot，否则 Node 子进程无法启动
  SystemRoot: process.env.SystemRoot,
  // macOS 保留 PATH 关键路径
  PATH: process.env.PATH,
};

const child = spawn(this.binaryPath, args, {
  env,
  // shell: false 在跨平台时更安全
  shell: false,
  // Windows 上避免命令行注入
  windowsVerbatimArguments: false,
  // 子进程独立进程组，便于 kill
  detached: process.platform !== 'win32',
});
```

### 3.6 测试矩阵

每次发布必须在以下矩阵上测试：

| 平台 | 操作系统 | 浏览器（Web 阶段） | 必测场景 |
|------|---------|------------------|---------|
| **macOS** | macOS 13 (Ventura) | Safari 17, Chrome 最新 | SSO 登录、技能调用、文件操作 |
| **macOS** | macOS 14 (Sonoma) | Safari 17, Chrome 最新 | 同上 |
| **macOS** | macOS 15 (Sequoia) | Safari 18, Chrome 最新 | 同上 |
| **Windows** | Windows 10 22H2 | Edge 最新, Chrome 最新 | 同上 + WebView2 检查 |
| **Windows** | Windows 11 23H2 | Edge 最新 | 同上 |
| **Windows** | Windows Server 2022（VDI） | Edge | 多用户 profile + 漫游 |

---

## 第 4 章 Windows 内网零依赖设计

### 4.1 内网部署的常见痛点

Windows 内网（特别是金融、政府、制造业）有特殊约束：

| 痛点 | 表现 | masterBot 的应对 |
|------|------|----------------|
| **无法访问外网** | npm/yarn 都装不了 | 客户端**纯静态资源**，无运行时安装 |
| **EXE 白名单** | 任意 .exe 都被 Defender / 集团策略拦 | EV 签名 + 提前申请白名单 |
| **WebView2 缺失** | 旧 Win10 没自动装 | 离线 Bootstrapper 嵌入 + Fallback |
| **MSI 必需** | SCCM 不支持 .exe 推送 | 同时构建 .exe + .msi |
| **管理员权限缺失** | 普通员工不能装管理员级软件 | per-user 安装模式 |
| **代理强制 + TLS 检查** | Zscaler/CrowdStrike | NODE_EXTRA_CA_CERTS 注入 |
| **DNS 限制** | 只能访问公司内网 | 所有依赖资源**走公司 CDN** |
| **离线场景** | 出差/网络问题 | 关键能力本地可用 |

### 4.2 Web 版阶段的零依赖策略

Web 版**天然零依赖**——员工只需要浏览器。但要注意：

**绝对禁止**：
- ❌ 引用任何外网 CDN（如 unpkg.com、jsdelivr）
- ❌ 加载外网字体（如 fonts.googleapis.com）
- ❌ 使用外网图标库 CDN（如 fontawesome）
- ❌ 加载外网分析（GA / Sentry 公网版）

**必须做到**：
- ✅ 所有 JS/CSS/字体/图标 **打包进资源服务器**（公司 nginx/oss）
- ✅ Service Worker 离线缓存（让网络抖动不影响使用）
- ✅ HTTP 头允许嵌入到飞书/钉钉的 iframe（CSP 配置）
- ✅ 图标用 SVG inline 或本地 sprite

**Vite 构建配置示例**：

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // 所有资源都打包，不走 CDN
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@radix-ui/react-*'],
        },
      },
    },
    // Hash 文件名利于缓存
    assetsDir: 'assets',
    // 内联小图片，减少请求
    assetsInlineLimit: 4096,
  },
  // 公司内网 CDN 路径
  base: '/masterBot-static/',
});
```

### 4.3 Electron 阶段的零依赖策略（核心）

到了 Electron 阶段，挑战更复杂。需要做到：**安装包包含一切，运行时零外部依赖**。

#### 4.3.1 WebView2 处理（Windows 关键）

WebView2 是 Windows 上 Electron 替代品的核心依赖（Tauri 必需）。**好消息：Electron 不需要 WebView2**（Electron 自带 Chromium）。

但如果未来某些功能用了 WebView2（如嵌入企业 BI 报表），处理方式：

```yaml
# electron-builder.yml
extraResources:
  # 离线 Bootstrapper（一次下载，多次复用）
  - from: 'resources/MicrosoftEdgeWebview2Setup.exe'
    to: 'webview2/bootstrapper.exe'
```

```typescript
// src/main/webview2-checker.ts
import { execFile } from 'child_process';
import path from 'path';

export class WebView2Checker {
  async ensureInstalled(): Promise<boolean> {
    const installed = await this.detectInstallation();
    if (installed) return true;

    // 离线安装（zero-network 场景）
    const bootstrapper = path.join(
      process.resourcesPath,
      'webview2',
      'bootstrapper.exe'
    );
    return this.runSilentInstall(bootstrapper);
  }

  private async detectInstallation(): Promise<boolean> {
    // 检查注册表
    return new Promise((resolve) => {
      execFile('reg', [
        'query',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        '/v', 'pv'
      ], (err, stdout) => {
        resolve(!err && stdout.includes('pv'));
      });
    });
  }
}
```

#### 4.3.2 Node.js 内置依赖（Electron 已包含）

Electron 自带 Node.js runtime，所以**不需要单独安装 Node**。但要确保：

- ✅ 所有 npm 依赖在**构建时**打包进 ASAR（不在用户机上 npm install）
- ✅ Native modules（如 sqlite3）用 `electron-rebuild` 预构建
- ✅ Node 22 内置 `node:sqlite` 优先用，避免 native binding

```json
// package.json
{
  "dependencies": {
    // 仅运行时必需，要打入安装包
  },
  "optionalDependencies": {
    // 平台特定的 native module
  }
}
```

```yaml
# electron-builder.yml
asar: true
asarUnpack:
  - "**/*.node"        # native modules 不能在 ASAR 中
  - "node_modules/@anthropic-ai/claude-agent-sdk/**"
  # SDK 内部 spawn 子进程，不能 ASAR 化

# 构建时验证依赖完整性
npmRebuild: true
buildDependenciesFromSource: false  # 用预构建的二进制
```

#### 4.3.3 .NET / Visual C++ Runtime

某些 native module 依赖 VC++ Redistributable。处理：

```yaml
# electron-builder.yml
nsis:
  include: 'build/installer.nsh'  # 自定义安装脚本

# build/installer.nsh
!include "MUI2.nsh"

Section "Visual C++ Redistributable" SecVCRedist
  # 检测已安装版本
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != "1"
    # 离线安装（installer 内嵌 vc_redist.x64.exe）
    File /oname=$TEMP\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
    ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart'
  ${EndIf}
SectionEnd
```

### 4.4 构建机器零依赖策略

不仅运行时零依赖，**构建机器**也要零依赖（避免每个开发者都装一堆东西）：

```yaml
# .github/workflows/build.yml
name: Build masterBot
on: [push]
jobs:
  build-windows:
    runs-on: windows-2022  # 公司自托管 Runner
    steps:
      - uses: actions/checkout@v4
      # 离线 Node（不下载）
      - run: |
          $env:Path = "C:\corp-tools\nodejs\v22;$env:Path"
          node --version
      # 离线 npm registry（公司 Nexus）
      - run: npm ci --registry=https://nexus.corp.com/repository/npm-proxy/
      - run: npm run build:win
      # 签名（CI 中调用 HSM）
      - run: signtool sign /sha1 ${{ secrets.CERT_THUMBPRINT }} /tr http://timestamp.corp.com /td sha256 dist\*.exe dist\*.msi
      - uses: actions/upload-artifact@v4
        with:
          name: masterBot-windows
          path: dist/

  build-macos:
    runs-on: macos-14  # 公司自托管 Mac mini
    steps:
      - uses: actions/checkout@v4
      - run: npm ci --registry=https://nexus.corp.com/repository/npm-proxy/
      - run: npm run build:mac
      # 签名 + 公证
      - run: |
          xcrun notarytool submit dist/*.dmg \
            --keychain-profile "AC_PASSWORD" \
            --wait
      - uses: actions/upload-artifact@v4
        with:
          name: masterBot-macos
          path: dist/
```

### 4.5 离线构建材料清单

为了在零外网环境构建，需要预准备：

| 材料 | 来源 | 体积 |
|------|------|------|
| Node.js 22 LTS | nodejs.org → 公司 Nexus | ~30MB |
| npm 依赖 | npm registry → Nexus 镜像 | ~500MB |
| Electron 二进制 | github.com/electron → Nexus | ~250MB |
| Anthropic Claude SDK | npm → Nexus | ~5MB |
| WebView2 Bootstrapper（备用） | Microsoft → 嵌入 | ~2MB |
| VC++ Redistributable | Microsoft → 嵌入 | ~25MB |
| 字体 / 图标 | 设计资产 → Git LFS | ~5MB |

总计 ~800MB 离线物料，存于公司 Nexus 后续无需联网。

### 4.6 检查清单（部署前必查）

- [ ] Windows 构建产物在 Win 10/11 净环境通过 SmartScreen
- [ ] MSI 包通过 SCCM 部署测试
- [ ] EXE 包用普通员工权限可安装
- [ ] 应用启动不联网（测试断网情况）
- [ ] 所有外部资源都来自公司域（开发者工具 Network 面板查）
- [ ] 安装后无 UAC 弹窗（per-user）
- [ ] 卸载干净（无残留注册表 / 文件）
- [ ] macOS 通过 Gatekeeper（公证完整）
- [ ] 公司 IT 部门接受签名证书

---

# 第三部分 Web-First 优先策略

## 第 5 章 为什么 Web 优先

### 5.1 Web 优先的核心理由

**理由 1：员工立即可用**
- Web 版上线 = 员工浏览器打开就能用
- 无需 IT 部门审批"安装新软件"
- 无需 SCCM 部署、无需用户操作

**理由 2：迭代速度**
- Web 版改 Bug 几分钟内生效
- Electron 版需要每个员工等待自动更新
- 早期 UI/UX 问题在 Web 版能快速验证

**理由 3：覆盖范围**
- 飞书/钉钉/企业微信都能内嵌 Web 应用
- 浏览器零安装、零权限要求
- 跨平台天然支持（Windows/macOS/Linux/iPad/Android）

**理由 4：风险可控**
- 桌面打包是最容易卡的环节（签名、公证、Defender、SCCM）
- 先打磨产品本身，再处理打包问题
- 桌面化时已有"既定 UI"作为参考

**理由 5：成本结构**
- Web 版基础设施已有（Next.js 16）
- 桌面化是叠加，不是替换

### 5.2 Web 优先的代价（明确认知）

虽然主推 Web，但要明确**Web 版无法做的事**，避免不切实际期待：

| 能力 | Web 版 | Electron 版 | 替代方案 |
|------|-------|------------|---------|
| 系统托盘 | ❌ | ✅ | Web Push 通知补足 |
| 全局快捷键 | ❌ | ✅ | 浏览器扩展（可选） |
| 文件系统直接访问 | ⚠️ File System Access API（仅 Chrome） | ✅ | 上传/下载流 |
| 子进程（Bash 执行） | ❌ | ✅ | 服务端代理执行 |
| 离线工作 | ⚠️ Service Worker 缓存 | ✅ | 关键场景缓存 |
| 本地数据库 | ⚠️ IndexedDB | ✅ SQLite | IndexedDB + 后端 |
| 系统通知 | ⚠️ Notification API | ✅ | 各 IM 渠道补 |
| 自启动 | ❌ | ✅ | 浏览器书签 |
| 屏幕录制/截图 | ⚠️ getDisplayMedia | ✅ | Web API 够用 |
| MCP stdio 服务器 | ❌ | ✅ | **服务端代理执行**（重点） |

### 5.3 关键架构调整：Server-Side MCP

Web 版无法在浏览器里启动 stdio MCP 服务器。这意味着 v3.0 中"客户端运行 MCP 服务器"的设计需要调整：

```
Electron 阶段（v3.0 原设计）：
浏览器 (Renderer) ←→ Main 进程 ←→ MCP 服务器 (子进程，本地)

Web 阶段（v3.1 调整）：
浏览器 ←→ Web 服务（公司部署）←→ MCP 服务器（服务端子进程或远程 SSE）
```

**带来的影响**：
- ✅ Web 阶段可以用 SSE/HTTP 类 MCP 服务器（远程连接）
- ✅ Web 阶段可以用服务端 stdio MCP（在 Web 服务进程里 spawn）
- ⚠️ 不能用员工本地的私有 MCP（如本地数据库连接）
- ✅ Electron 阶段恢复"客户端 MCP 子进程"能力

**这是 v3.0 → v3.1 的重要妥协**：Web 阶段牺牲了一部分本地能力，换来快速上线。Electron 阶段补齐。

---

## 第 6 章 Web 版的能力边界与降级方案

### 6.1 Web 版功能矩阵

按 v3.0 提到的核心能力，Web 阶段的实现状态：

| 能力 | Web 版 | 实现方式 | 备注 |
|------|--------|---------|------|
| 对话式 Agent | ✅ 完整 | AG-UI SSE | 核心场景 |
| Skills 加载 | ✅ 完整 | 服务端加载 | 与 Electron 对等 |
| Subagents 委派 | ✅ 完整 | 服务端 SDK | 对等 |
| MCP 工具 | ⚠️ 服务端 | SSE/服务端 stdio | 个人 MCP 缺失 |
| 文件操作 | ⚠️ 上传/下载 | Web API | 本地文件需 Electron |
| Memory 检索 | ✅ 完整 | 服务端 DuckDB | 服务端版（暂不本地） |
| Skill Factory（个人草稿） | ✅ 完整 | 服务端沙箱 | 服务端实现 |
| Skill Factory（提交） | ✅ 完整 | 服务端 | 对等 |
| 飞书/钉钉/企微 | ✅ 完整 | 各家 SDK | Web 适配最佳 |
| SSO 登录 | ✅ 完整 | OAuth/SAML | Web 标准 |
| 离线工作 | ⚠️ 部分 | Service Worker | 仅查看历史 |
| 审计日志 | ✅ 完整 | 服务端 | 集中存储 |
| 三轨升级 | ⚠️ 简化 | 仅 Track 3 | Track 1/2 在 Electron 阶段 |

### 6.2 Web 阶段的"两轨"升级

由于 Web 阶段没有客户端二进制，三轨升级简化为两轨：

```
Track 1: 应用本体     →  服务端发版（无需客户端动作）
Track 2: 技能         →  服务端 Skill Registry 直接更新（员工浏览器拉取）
Track 3: 配置/策略    →  服务端配置中心（员工浏览器轮询）
```

实际上 Web 阶段是"零轨升级"——员工只需刷新浏览器就拿到最新版本。

### 6.3 Web 版数据存储调整

v3.0 原方案的本地 SQLite + DuckDB 在 Web 阶段必须改为**服务端存储**：

```
Web 阶段（中心化）：
浏览器 → 服务端 PostgreSQL (业务数据)
     → 服务端 pgvector (向量记忆)
     → 服务端 ClickHouse (审计日志)

Electron 阶段（v3.0 原设计，加回本地）：
客户端 SQLite (本地缓存)
客户端 DuckDB (向量缓存)
+ 服务端持久化 (作为同步备份)
```

**关键决策**：Web 阶段的服务端数据库**保留**到 Electron 阶段，作为**云端备份 + 跨设备同步源**。这给 Electron 阶段带来一个 Bonus —— 员工可以在多台设备上使用，数据自动同步。

### 6.4 用户感知层面的体验差异

```
Web 版（员工体验）：
1. 浏览器打开企业门户 → 点击 "AI 助手"
2. 进入 Web 应用，自动 SSO 登录
3. 开始对话
4. 关闭浏览器 → 数据保存在云端

Electron 版（员工体验）：
1. 双击桌面图标
2. 应用启动（首次需登录，后续记住）
3. 系统托盘常驻
4. 全局快捷键随时呼出
5. 数据本地存储 + 云端同步
```

Web 版**够用**，Electron 版**更顺手**。这是合理的渐进式投入。

---

## 第 7 章 Web → Electron 平滑过渡设计

### 7.1 设计原则：复用最大化

**目标**：Web 版的 95% 代码在 Electron 阶段直接复用，仅 5% 是 Electron 特有逻辑。

```
共享层（95%）：
├── Frontend (Next.js + UI 组件)
├── Agent Engine (ClaudeManagedAgent + Legacy)
├── Hooks 系统
├── Skills Registry 客户端
├── Permission Engine
├── Memory Router
├── 业务逻辑
└── API 协议

Electron 特有（5%）：
├── Main 进程（窗口管理、IPC、系统集成）
├── electron-updater 集成
├── 本地数据库 SQLite/DuckDB（Web 阶段是服务端版）
├── 子进程 MCP（Web 阶段是服务端版）
├── 系统托盘 / 全局快捷键
└── 文件系统直接访问
```

### 7.2 关键抽象设计：Storage Adapter

让数据存储**在 Web 和 Electron 之间无缝切换**：

```typescript
// src/storage/types.ts
export interface IStorageAdapter {
  // 业务数据
  getSession(id: string): Promise<Session>;
  saveSession(s: Session): Promise<void>;

  // 向量记忆
  searchMemory(query: string, k: number): Promise<MemoryItem[]>;
  upsertMemory(item: MemoryItem): Promise<void>;

  // 审计
  writeAudit(event: AuditEvent): Promise<void>;
  queryAudit(filter: AuditFilter): Promise<AuditEvent[]>;
}

// src/storage/web-adapter.ts (Web 阶段)
export class WebStorageAdapter implements IStorageAdapter {
  constructor(private apiClient: ApiClient) {}

  async getSession(id: string) {
    return this.apiClient.get(`/api/sessions/${id}`);
  }

  async searchMemory(query: string, k: number) {
    return this.apiClient.post('/api/memory/search', { query, k });
  }
  // ... 都走 HTTP
}

// src/storage/electron-adapter.ts (Electron 阶段，新增)
export class ElectronStorageAdapter implements IStorageAdapter {
  constructor(
    private localDb: LocalSqliteDB,
    private vectorDb: DuckDBClient,
    private apiClient: ApiClient,  // 仍保留用于云同步
  ) {}

  async getSession(id: string) {
    // 优先读本地缓存
    const local = await this.localDb.getSession(id);
    if (local) return local;
    // 缓存未命中，远程拉取并缓存
    const remote = await this.apiClient.get(`/api/sessions/${id}`);
    await this.localDb.saveSession(remote);
    return remote;
  }
  // ... 本地优先 + 云同步
}
```

**结果**：业务代码完全不感知存储是 Web 还是 Electron，只调 `IStorageAdapter` 接口。Electron 阶段只需增加 `ElectronStorageAdapter` 实现。

### 7.3 关键抽象设计：MCP Adapter

```typescript
// src/mcp/types.ts
export interface IMcpClient {
  listTools(serverName: string): Promise<Tool[]>;
  callTool(serverName: string, toolName: string, args: any): Promise<any>;
}

// src/mcp/web-mcp-client.ts（Web 阶段）
export class WebMcpClient implements IMcpClient {
  // 通过服务端 API 调用
  async listTools(serverName: string) {
    return this.apiClient.get(`/api/mcp/${serverName}/tools`);
  }
  async callTool(serverName: string, toolName: string, args: any) {
    return this.apiClient.post(`/api/mcp/${serverName}/call`, {
      tool: toolName,
      args,
    });
  }
}

// src/mcp/electron-mcp-client.ts（Electron 阶段）
export class ElectronMcpClient implements IMcpClient {
  // 直接 spawn 子进程
  constructor(private processManager: McpProcessManager) {}

  async listTools(serverName: string) {
    return this.processManager.list(serverName);
  }
  async callTool(serverName: string, toolName: string, args: any) {
    return this.processManager.call(serverName, toolName, args);
  }
}
```

### 7.4 配置化切换

```typescript
// src/factory.ts
import { app, getPlatform } from './platform';

export function createStorageAdapter(): IStorageAdapter {
  if (app.runtimeMode === 'electron') {
    return new ElectronStorageAdapter(
      new LocalSqliteDB(),
      new DuckDBClient(),
      new ApiClient(),
    );
  }
  return new WebStorageAdapter(new ApiClient());
}

export function createMcpClient(): IMcpClient {
  if (app.runtimeMode === 'electron') {
    return new ElectronMcpClient(new McpProcessManager());
  }
  return new WebMcpClient(new ApiClient());
}
```

### 7.5 过渡期的双轨运营

Web 上线后到 Electron 上线前的 6-8 周：

```
员工 A（早 adopter，要桌面版）
     ↓
   Web 版（暂时使用）→ 等 Electron 发布

员工 B（普通用户）
     ↓
   Web 版（持续使用）→ 自然升级到 Electron

员工 C（特殊网络限制）
     ↓
   Web 版永久使用
```

策略：
- **Web 版长期保留**（不下线）
- Electron 版作为"增强版"提供
- 数据云端同步，用户可随时切换

---

# 第四部分 UI/UX 设计优化

## 第 8 章 设计原则与设计系统

### 8.1 五大设计原则

借鉴 2026 年最佳实践（ChatGPT / Claude / Cowork / Linear），结合企业场景：

#### P1. Conversation First（对话优先）
- 主交互永远是聊天框
- 工具/审批 / 设置都隐于其后
- 避免大量按钮和复杂菜单
- 像 Claude 一样**让内容主导界面**

#### P2. Progressive Disclosure（渐进显示）
- 默认极简界面
- 高级功能藏在二级页面
- 关键操作（如"创建技能"）显眼，次要操作（设置）藏起来
- 与 Anthropic Skills 协议哲学一致

#### P3. Agent Transparency（智能体透明度）
- 实时显示 agent 在做什么（thinking、tool call、subagent）
- 让员工**看见 + 信任** agent
- 支持"展开思考过程"（Claude 的 extended thinking 展示）
- 不要黑盒

#### P4. Trust Cues（信任线索）
- 危险操作前清晰警告
- 数据来源标注（哪个工具/哪个文档）
- 引用可点击查看
- 显示模型、token、成本（高级用户）

#### P5. Calm by Default（默认沉静）
- 不主动推送
- 不弹窗骚扰
- 加载/思考状态优雅
- 错误提示克制（不要满屏红色）

### 8.2 设计系统：Design Tokens

```typescript
// design/tokens.ts
export const tokens = {
  // 色彩（暖色调，Anthropic 灵感）
  color: {
    // Brand
    'brand-primary': '#cc7a4e',      // 暖橙
    'brand-warm': '#d4936b',          // 浅橙
    'brand-deep': '#a85d36',          // 深橙

    // Surface
    'surface-base': '#ffffff',        // 主背景（亮）
    'surface-elevated': '#fafaf8',    // 卡片背景
    'surface-sunken': '#f5f4f1',     // 凹陷区域

    // Surface Dark Mode
    'surface-base-dark': '#0f1419',
    'surface-elevated-dark': '#1a2028',
    'surface-sunken-dark': '#0a0e13',

    // Text
    'text-primary': '#1a1a1a',
    'text-secondary': '#5a5a5a',
    'text-tertiary': '#8a8a8a',
    'text-inverse': '#ffffff',

    // Semantic
    'success': '#7cb98a',
    'warning': '#d4a661',
    'error': '#d47a8e',
    'info': '#6ba3e8',

    // Border
    'border-subtle': '#e8e6e0',
    'border-default': '#d0cdc4',
    'border-strong': '#9b9789',
  },

  // 字体
  font: {
    family: {
      sans: '"Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      mono: '"JetBrains Mono", "SF Mono", Consolas, monospace',
      display: '"Fraunces", "Source Serif Pro", "Songti SC", serif',
    },
    size: {
      'xs': '11px',
      'sm': '13px',
      'base': '14px',
      'lg': '16px',
      'xl': '18px',
      '2xl': '22px',
      '3xl': '28px',
      '4xl': '36px',
      '5xl': '48px',
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  // 间距（8px 基础栅格）
  space: {
    '0': '0',
    '0.5': '2px',
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '5': '20px',
    '6': '24px',
    '8': '32px',
    '10': '40px',
    '12': '48px',
    '16': '64px',
    '20': '80px',
    '24': '96px',
  },

  // 圆角
  radius: {
    'none': '0',
    'sm': '4px',
    'base': '6px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    '2xl': '20px',
    'full': '9999px',
  },

  // 阴影（精细，避免 AI 风的过度光晕）
  shadow: {
    'subtle': '0 1px 2px rgba(0,0,0,0.04)',
    'soft': '0 2px 8px rgba(0,0,0,0.06)',
    'medium': '0 4px 16px rgba(0,0,0,0.08)',
    'strong': '0 8px 32px rgba(0,0,0,0.12)',
  },

  // 动画
  motion: {
    duration: {
      'fast': '150ms',
      'normal': '250ms',
      'slow': '400ms',
    },
    easing: {
      'out': 'cubic-bezier(0.16, 1, 0.3, 1)',  // 标准
      'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)', // 平滑
    },
  },
};
```

### 8.3 主题模式

支持三种主题：

| 主题 | 适用 | 特点 |
|------|------|------|
| **Light** | 默认，办公室明亮环境 | 白底、暖色点缀、低对比度 |
| **Dark** | 夜间、长时间使用 | 深蓝灰底、暖橙提亮 |
| **High Contrast** | 可访问性需求 | 黑白对比度极高，符合 WCAG AAA |

实现：CSS 变量 + `data-theme` 属性切换。

---

## 第 9 章 核心界面重设计

### 9.1 主界面布局

```
┌──────────────────────────────────────────────────────────────────┐
│  Header (sticky)                                                  │
│  ┌────────┬─────────────────────────────────┬──────────────────┐ │
│  │ Logo   │ Workspace 切换器                │ 用户头像 / 设置  │ │
│  └────────┴─────────────────────────────────┴──────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ Side  │                                                          │
│ Bar   │           主对话区（Chat View）                          │
│       │                                                          │
│ ┌───┐ │  ┌────────────────────────────────────────────────────┐ │
│ │ ＋ │ │  │ 系统欢迎语                                         │ │
│ │新对│ │  └────────────────────────────────────────────────────┘ │
│ │ 话 │ │                                                          │
│ └───┘ │  ┌─ User ─────────────────────────────────────────────┐ │
│       │  │ 帮我查上个月入职的员工                               │ │
│ ─────  │  └────────────────────────────────────────────────────┘ │
│ 历史   │                                                          │
│ 对话   │  ┌─ Assistant ────────────────────────────────────────┐ │
│ ▸ 今天 │  │ ⚙ 思考中... (展开/收起)                            │ │
│ ▸ 昨天 │  │ 🔧 调用 hr.employee-query (✓)                       │ │
│ ▸ 本周 │  │                                                     │ │
│       │  │ 上月入职 24 人，详细如下：                            │ │
│ ─────  │  │ [Markdown 表格]                                    │ │
│ 技能   │  │                                                     │ │
│ 市场   │  │ 引用：HRIS 数据 · 截至 2026-04-30                  │ │
│ ▸ 我的 │  └────────────────────────────────────────────────────┘ │
│ ▸ 部门 │                                                          │
│ ▸ 全公司│  ┌────────────────────────────────────────────────────┐ │
│       │  │ 输入消息或 / 选择技能...               [→ 发送]     │ │
│ ─────  │  └────────────────────────────────────────────────────┘ │
│ 技能工 │                                                          │
│ 厂 ✨  │                                                          │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 关键页面清单

按优先级排序：

| 页面 | 优先级 | 用途 |
|------|--------|------|
| **Chat（对话）** | P0 | 主交互界面 |
| **Login（登录）** | P0 | SSO 登录 |
| **Skill Catalog（技能市场）** | P0 | 浏览企业技能 |
| **Skill Factory（技能工厂）** | P0 | 自助创建技能 |
| **Settings（设置）** | P1 | 个人偏好 |
| **History（历史）** | P1 | 历史对话 |
| **Connectors（连接器）** | P2 | 配置外部工具 |
| **Admin Console（管理后台）** | P2 | 仅管理员 |
| **Audit Log（审计）** | P3 | 仅合规人员 |

### 9.3 Chat 页面深入设计

#### 9.3.1 消息卡片设计

```
┌─ User ────────────────────────────────────────────┐
│  帮我整理今天工作                              ⋮  │
│                                            12:30  │
└───────────────────────────────────────────────────┘

┌─ Assistant ───────────────────────────────────────┐
│  ⚙ Reasoning（折叠，点击展开）                    │
│  ──────────────────────────────────────────────── │
│  📨 调用 email-handler · 检查邮件                 │
│     └─ 完成 (2.1s)                                │
│  📅 调用 calendar-handler · 查日程                │
│     └─ 完成 (0.8s)                                │
│  ──────────────────────────────────────────────── │
│                                                    │
│  根据您今天的安排：                                │
│  ▪ 上午 10:00 与张总会议（已确认）                 │
│  ▪ 3 封需回复邮件（其中 1 封紧急）                 │
│  ▪ 2 个待办 Jira 任务 due 今天                     │
│                                                    │
│  建议优先级：                                      │
│  1. 9:00 处理紧急邮件                              │
│  2. 9:30 准备 10 点会议材料                        │
│  3. 11:00 处理 Jira 任务                           │
│                                                    │
│  ────────────────────────────────────────────────  │
│  📊 来源：Outlook · Google Calendar · Jira         │
│  💰 0.012 USD · 2.3s · claude-opus-4-7            │
│  ❤ 👍 👎 ⤴ 重新生成 · ⭐ 保存为模板               │
└───────────────────────────────────────────────────┘
```

#### 9.3.2 输入框设计

```
┌────────────────────────────────────────────────────┐
│  💡 输入消息或 / 选择技能...                        │
│                                                     │
│  附件: 📎  /命令: ⌘K  模型: 🤖 Opus               │
└────────────────────────────────────────────────────┘
```

特性：
- **/ 触发技能选择**（类似 Linear / Notion）
- **@ 提及具体 subagent**（让请求路由到指定专家）
- **Shift+Enter 换行**，Enter 发送
- **多行自适应高度**（最多 8 行，超过滚动）
- **草稿自动保存**（防止误关闭丢失）

#### 9.3.3 Tool Call 可视化

每个工具调用一个折叠卡片：

```
┌─────────────────────────────────────────────┐
│ 🔧 hr.employee-query                  ✓ 1.2s│
│ ─────────────────────────────────────────── │
│ Input: { month: "2026-04" }                  │
│ Output: 24 employees ▾ 展开查看              │
└─────────────────────────────────────────────┘
```

**设计细节**：
- 默认折叠，点击展开
- 状态图标：⏳ 进行中 / ✓ 成功 / ✗ 失败 / ⚠ 警告
- 失败时高亮 + 显示错误
- 入参/出参点击可复制

#### 9.3.4 审批弹窗（HitL）

危险操作触发审批：

```
┌─────────────────────────────────────────────┐
│ ⚠ 需要审批                                  │
│ ─────────────────────────────────────────── │
│ Agent 想要:                                  │
│   📧 发送邮件                                │
│   收件人: ceo@external-corp.com              │
│   主题: 季度报告                              │
│                                              │
│ 风险：跨部门外发 + 含 PII                     │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ [预览邮件正文 ▾]                          │ │
│ │                                          │ │
│ │ 您可以编辑后再发送：                      │ │
│ │ 主题: [可编辑文本框]                      │ │
│ │ 正文: [可编辑文本框]                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ❌ 拒绝   ✏️ 修改后批准   ✅ 直接批准        │
└─────────────────────────────────────────────┘
```

**关键设计**：
- "Approve with changes" 是核心特性
- 显示风险等级
- 必要时显示完整 payload 预览
- 一键拒绝时记录原因（可选）

### 9.4 Skill Catalog（技能市场）设计

```
┌──────────────────────────────────────────────────────────────────┐
│ Skill Catalog                                          + 创建技能 │
├──────────────────────────────────────────────────────────────────┤
│ 🔍 搜索技能...    | 全部 | 我的 | 部门 | 推荐 |  按使用率 ▾      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│ │ 📊 NL2SQL       │ │ ✉ 邮件助手      │ │ 📅 会议安排     │    │
│ │ ─────────────── │ │ ─────────────── │ │ ─────────────── │    │
│ │ 自然语言查询数  │ │ 起草、回复邮件  │ │ 自动找空闲时间  │    │
│ │ 据库            │ │                 │ │ 安排会议        │    │
│ │                 │ │                 │ │                 │    │
│ │ ⭐ 企业精选     │ │ 👤 by HR Team   │ │ 👤 by IT Team   │    │
│ │ 📈 1.2K 次/月   │ │ 📈 800 次/月    │ │ 📈 500 次/月    │    │
│ │                 │ │                 │ │                 │    │
│ │ [使用]          │ │ [使用]          │ │ [使用]          │    │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘    │
│                                                                   │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│ │ ...             │ │ ...             │ │ ...             │    │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**特性**：
- 卡片瀑布流，每张卡片显示关键信息
- 筛选：全部 / 我的 / 部门 / 推荐
- 排序：使用率 / 最新 / 评分
- 搜索：关键词 + 标签
- 点击卡片进入详情页

### 9.5 Skill Factory（技能工厂）设计

最关键的差异化界面，必须做精致：

```
┌──────────────────────────────────────────────────────────────────┐
│ ✨ 创建新技能                                                     │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Step 1/5: 描述你想要的技能                              │   │
│  │  ────────────────────────────────────────────────────────│   │
│  │                                                            │   │
│  │  💬 我想做一个能查我们部门 Jira 的技能                    │   │
│  │                                                            │   │
│  │  AI: 好的，让我帮你设计。先问几个问题：                    │   │
│  │   1. 你们部门的 Jira project key 是？                     │   │
│  │   2. 主要查询哪些字段？（状态/负责人/截止日期）            │   │
│  │   3. 谁可以使用这个技能？（仅自己/部门/全公司）            │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │ 输入回答...                                       │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  进度: ●─○─○─○─○                                                  │
│  Understand → Synthesize → Verify → Eval → Publish                │
└──────────────────────────────────────────────────────────────────┘
```

**5 步可视化进度**：
- Step 1 Understand：对话式澄清
- Step 2 Synthesize：实时显示生成代码
- Step 3 Verify：列出每项检查（结构 ✓ 安全 ✓ 命名 ✓）
- Step 4 Eval：测试用例运行结果
- Step 5 Publish：选择发布范围（个人 / 提交企业）

每步可以**返回修改**，关键设计是**让员工感觉技能创建不复杂**。

---

## 第 10 章 关键交互模式

### 10.1 实时反馈

所有需要等待的操作都要有反馈：

| 等待时间 | 反馈类型 |
|---------|---------|
| < 0.1s | 即时（无需反馈） |
| 0.1s - 1s | 微动画（按钮加载态） |
| 1s - 3s | Loading + 文字（"正在查询..."） |
| 3s - 10s | 进度（步骤指示） |
| > 10s | 进度条 + 取消按钮 |
| > 30s | 后台任务提示（"完成后通知您"） |

### 10.2 错误处理

错误不是"满屏红色警告"，而是**温和引导**：

```
┌──────────────────────────────────────────────┐
│ 😅 暂时无法查询 Jira                          │
│ ──────────────────────────────────────────── │
│ 可能原因：                                    │
│ • Jira API 暂时不可达                        │
│ • 您的访问权限不足                           │
│                                               │
│ 您可以：                                      │
│ ▸ 重试                                       │
│ ▸ 查看 Jira 网站                             │
│ ▸ 联系 IT 支持                               │
└──────────────────────────────────────────────┘
```

### 10.3 快捷键

借鉴 Linear / Notion 的快捷键体系：

| 快捷键 | 功能 |
|--------|------|
| `⌘K` / `Ctrl+K` | 命令面板 |
| `⌘N` / `Ctrl+N` | 新对话 |
| `⌘/` / `Ctrl+/` | 选择技能 |
| `⌘Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `⌘\` / `Ctrl+\` | 切换侧栏 |
| `⌘D` / `Ctrl+D` | 切换深色模式 |
| `↑` 在空输入框 | 编辑上一条 |
| `Esc` | 关闭弹窗 |

### 10.4 命令面板

`⌘K` 触发，全局搜索 + 操作：

```
┌──────────────────────────────────────────────┐
│ 🔍 输入命令或搜索...                          │
│ ──────────────────────────────────────────── │
│ 最近                                          │
│ ⏱  对话: 上月入职员工查询                    │
│ ⏱  技能: hr.employee-query                  │
│                                               │
│ 操作                                          │
│ ⚡ 新对话                  ⌘N                 │
│ ⚡ 创建技能                              │
│ ⚡ 切换深色模式            ⌘D                 │
│ ⚡ 打开设置                              │
│                                               │
│ 技能                                          │
│ 🔧 NL2SQL 数据查询                           │
│ 🔧 邮件助手                                  │
└──────────────────────────────────────────────┘
```

### 10.5 通知系统

分级通知：

| 级别 | 表现 | 例子 |
|------|------|------|
| **Info** | 浮层 toast，3s 自动消失 | "技能已更新" |
| **Success** | 浮层 toast，3s | "邮件已发送" |
| **Warning** | 浮层 toast，5s | "任务接近超时" |
| **Error** | 卡片，需手动关闭 | "Jira 连接失败" |
| **HitL** | 模态弹窗，必须响应 | "需要审批：发邮件给外部" |

### 10.6 多模态输入

支持多种输入方式（在 Web API 范围内）：

| 输入 | 实现 | 平台兼容 |
|------|------|---------|
| 文字 | 标准 textarea | 全平台 |
| 文件上传 | drag-drop + click | 全平台 |
| 截图 | Clipboard API（Ctrl+V 粘贴图片） | Chrome/Edge/Safari 17+ |
| 语音 | Web Speech API | Chrome/Edge（Safari 部分） |
| 摄像头 | getUserMedia | 全平台（需权限） |

---

## 第 11 章 可访问性与国际化

### 11.1 WCAG 2.1 AA 合规

企业部署必须满足无障碍要求（特别是政府/银行客户）：

- ✅ **键盘导航**：所有功能可纯键盘操作
- ✅ **屏幕阅读器**：ARIA 标签完整
- ✅ **色彩对比度**：文字 ≥ 4.5:1，大字 ≥ 3:1
- ✅ **Focus 可见**：明显的 focus ring
- ✅ **错误识别**：错误不只用颜色表达
- ✅ **可调字号**：支持浏览器缩放 200%
- ✅ **无动画选项**：尊重 `prefers-reduced-motion`

### 11.2 国际化

主推中文，保留英文支持：

```typescript
// src/i18n/index.ts
export const i18n = {
  defaultLocale: 'zh-CN',
  supportedLocales: ['zh-CN', 'zh-TW', 'en-US', 'ja-JP'],
  fallback: 'zh-CN',
};
```

**关键设计**：
- 所有 UI 文本走 i18n key
- 日期/时间用 `Intl.DateTimeFormat`
- 数字货币用 `Intl.NumberFormat`
- 字体栈针对中日韩优化（避免衬线显示问题）

### 11.3 暗色模式

不只是反色，要重新设计：

| 元素 | Light | Dark |
|------|-------|------|
| 主背景 | #ffffff | #0f1419 |
| 卡片 | #fafaf8 | #1a2028 |
| 文字 | #1a1a1a | #e8ecf2 |
| 品牌色 | #cc7a4e | #d4936b（提亮） |

---

# 第五部分 实施计划修订

## 第 12 章 修订后的 16 阶段路线图

### 12.1 总览（24 周）

```
v3.1 路线图

[Foundation Phase]
  P0  准备工作                          1 周
  P1  可观测性先行                      1 周
  P2  Hooks 重构                        2 周
  P2.5 Identity & Policy Foundation     2 周

[Hybrid Engine Phase]
  P3  ClaudeManagedAgent 上线           2 周
  P4  Skills + Subagents 升级           2 周
  P5  Session 高级特性                  1 周

[Enterprise Phase]
  P6  Memory 四层 + 租户隔离             2 周
  P7  企业 IM 一等公民                   2 周
  P8  Admin Console（基础）             1 周
  P9  评估金字塔（启动）                 持续

[Skill Factory Phase]
  P9.5 Skill Factory 2.0                3 周

[Web First Phase（核心）]
  P9.7 ★ UI/UX Design System          2 周   新增
  P10  ★ Web 版 MVP                    2 周   重新定位
  P11  ★ Web 版灰度 + 上线              2 周   新增
  P12  ★ Web 版迭代运营                 持续  新增

[Electron Phase]
  P13  ★ Electron 准备 + 适配           1 周   新增
  P14  Electron 打包（macOS+Win）       2 周   原 P10 内容
  P15  三轨升级体系                     3 周   原 P11
  P16  Electron 灰度 + 上线              持续  原 P12
```

### 12.2 修订后的关键 Phase

#### P9.7 · UI/UX Design System（新增 · 2 周）

**目标**：建立完整设计系统，避免后续 UI 反复重做

**任务**：
- `#issue-NEW-26` 设计 Token 体系（color/font/space/radius）
- `#issue-NEW-27` 暗色 + 亮色 + 高对比度三主题
- `#issue-NEW-28` 核心组件库（基于 Radix UI + Tailwind）
- `#issue-NEW-29` Chat 消息卡片设计
- `#issue-NEW-30` Tool Call 可视化卡片
- `#issue-NEW-31` HitL 审批弹窗
- `#issue-NEW-32` Skill Catalog 卡片设计
- `#issue-NEW-33` Skill Factory 多步进度设计
- `#issue-NEW-34` 命令面板（Cmd+K）
- `#issue-NEW-35` Storybook 文档

**交付物**：
- Figma 设计文件
- 组件库 npm 包
- Storybook 在线文档
- 设计审查通过

**关键里程碑**：✅ 后续所有页面只用现成组件，不再造轮子

---

#### P10 · Web 版 MVP（2 周，重新定位）

**目标**：第一个员工能用上的版本

**任务**：
- `#issue-NEW-36` Next.js 16 框架升级 + AG-UI 集成
- `#issue-NEW-37` Chat 主页面（消息流 + 输入框）
- `#issue-NEW-38` Login 页（SSO 登录）
- `#issue-NEW-39` Skill Catalog 页面
- `#issue-NEW-40` History 历史对话页
- `#issue-NEW-41` Settings 设置页
- `#issue-NEW-42` 响应式适配（桌面 + 平板）
- `#issue-NEW-43` Web 专属 Storage Adapter
- `#issue-NEW-44` Web 专属 MCP Adapter
- `#issue-NEW-45` Service Worker 离线缓存

**交付物**：可访问的 Web 应用

**关键里程碑**：✅ 内部 demo 通过

---

#### P11 · Web 版灰度上线（2 周，新增）

**目标**：真正交付到员工手上

**任务**：
- `#issue-NEW-46` 部署到公司内网服务器（K8s 或 Docker）
- `#issue-NEW-47` 配置 nginx 静态资源 + SSL
- `#issue-NEW-48` 域名/路径配置（如 `aibot.corp.com`）
- `#issue-NEW-49` 接入企业门户（飞书/钉钉首页 widget）
- `#issue-NEW-50` 内测：10 人核心用户
- `#issue-NEW-51` 反馈收集机制（应用内反馈）
- `#issue-NEW-52` 灰度扩展：50 人 → 200 人 → 全员
- `#issue-NEW-53` 性能监控（Real User Monitoring）
- `#issue-NEW-54` 用户引导（onboarding tour）

**交付物**：员工可用的 Web 应用

**关键里程碑**：✅ 全公司可用，NPS ≥ 40

---

#### P12 · Web 版迭代运营（持续）

**目标**：基于真实使用数据快速迭代

**任务**：
- 双周迭代节奏
- 用户反馈优先处理
- 月度产品报告
- A/B 测试 UI 改进

---

#### P13 · Electron 准备 + 适配（1 周，新增）

**目标**：为 Electron 阶段做技术准备

**任务**：
- `#issue-NEW-55` 引入 Electron 36 + electron-builder
- `#issue-NEW-56` Main + Renderer + Worker 进程架构
- `#issue-NEW-57` IPC Adapter 设计（Main 与 Renderer 通信）
- `#issue-NEW-58` Storage Adapter 切换到 Electron 模式
- `#issue-NEW-59` MCP Adapter 切换到本地子进程模式
- `#issue-NEW-60` 构建管线（macOS + Windows）

**交付物**：本地能跑的 Electron dev 版

---

#### P14 · Electron 打包（2 周）

**目标**：可分发的桌面应用

**任务**：
- `#issue-NEW-61` macOS Universal Binary 构建
- `#issue-NEW-62` macOS 代码签名 + 公证
- `#issue-NEW-63` Windows MSI + EXE 双格式构建
- `#issue-NEW-64` Windows EV 签名（避免 SmartScreen）
- `#issue-NEW-65` 系统托盘 + 全局快捷键
- `#issue-NEW-66` 通知系统（macOS Notification + Windows Toast）
- `#issue-NEW-67` 启动性能优化（< 2 秒）
- `#issue-NEW-68` 资源占用优化（idle < 200MB）
- `#issue-NEW-69` 跨平台测试矩阵

**交付物**：.dmg + .msi + .exe 三平台安装包

---

#### P15 · 三轨升级体系（3 周）

（与 v3.0 P11 内容相同）

---

#### P16 · Electron 灰度上线（持续）

**目标**：渐进式从 Web 切到 Electron

**任务**：
- `#issue-NEW-70` Electron 首批：50 人技术用户
- `#issue-NEW-71` 反馈收集
- `#issue-NEW-72` 扩大到所有 Web 用户
- `#issue-NEW-73` Web 版长期保留（不下线）
- `#issue-NEW-74` 数据云同步验证

---

### 12.3 路线图对比

```
v3.0：员工 22 周后用上 → 一次大爆发
       └─ 风险高（最后才知效果）

v3.1：员工 18 周后用上 Web 版 → 快速反馈
       └─ 24 周后用上 Electron 增强版
       └─ 风险分散（早期产品验证）
```

---

## 第 13 章 关键里程碑变化

### 13.1 修订后的里程碑

| 里程碑 | 时点 | 标志 | 决策点 |
|--------|------|------|--------|
| **M1** | P1 完成（第 2 周） | 看见每次 agent 调用 | 决定是否继续 P2 |
| **M2** | P3 完成（第 8 周） | Claude Managed 5% 跑通 | 决定 SDK 路径放量 |
| **M3** | P9.5 完成（第 16 周） | Skill Factory 2 小时上线 | 决定 UI 设计投入 |
| **M3.5** | P9.7 完成（第 18 周） | 设计系统就绪 | **新增** |
| **M4** | P11 完成（第 22 周） | **Web 版上线，员工开始用** | **核心里程碑** |
| **M5** | P14 完成（第 26 周） | Electron 桌面版可分发 | 决定灰度范围 |
| **M6** | P16 启动（第 30 周） | 桌面版全员可用 | 决定后续节奏 |

**关键变化**：M4 提前到第 22 周，比 v3.0 的 22 周完成"全套"早了 8 周交付价值。

---

# 附录

## 附录 A · Windows 内网部署清单

### A.1 部署前准备

公司 IT 团队需要准备：

- [ ] 内部 npm registry（Nexus / Verdaccio）
- [ ] 内部 Docker registry（Harbor / Nexus）
- [ ] 内部代码签名证书（Windows EV + Apple Dev）
- [ ] 公司 CDN（OSS / 文件服务器）
- [ ] SSO IdP 配置（OAuth client）
- [ ] LLM Gateway 部署（Anthropic / Bedrock 凭据）
- [ ] 防火墙白名单（如有）

### A.2 客户端部署清单（Web 阶段）

- [ ] 浏览器要求：Chrome 100+ / Edge 100+ / Safari 17+
- [ ] 网络访问：`aibot.corp.com`（公司内部域名）
- [ ] 用户引导：内部 wiki / 培训
- [ ] IT 支持：常见问题文档

### A.3 客户端部署清单（Electron 阶段）

- [ ] EV 证书：申请 + 安装到构建机
- [ ] 公司内部下载页：`download.corp.com/masterBot`
- [ ] SCCM 推送包：MSI 准备
- [ ] Defender 白名单：与安全团队对接
- [ ] WebView2 检查：（不需要，Electron 自带 Chromium）
- [ ] Apple TeamID + Notarization 凭据
- [ ] 自动更新服务器：内部 OSS

### A.4 Windows 兼容性测试矩阵

| 组合 | 必测 |
|------|------|
| Win 10 22H2 + Edge 最新 | ✅ |
| Win 10 22H2 + Chrome 最新 | ✅ |
| Win 11 23H2 + Edge | ✅ |
| Win 11 24H2 + Edge | ✅ |
| Windows Server 2022 + Edge | ✅（VDI 场景） |
| ARM64 设备 | ⚠️ 后续考虑 |

---

## 附录 B · Web vs Electron 能力对照表

详细对照表，用于产品决策：

| 能力分类 | 子能力 | Web 版 | Electron 版 | 备注 |
|---------|-------|-------|------------|------|
| **基础对话** | 流式输出 | ✅ | ✅ | AG-UI |
| | 多轮上下文 | ✅ | ✅ | 服务端会话 |
| | 工具调用展示 | ✅ | ✅ | 卡片化 |
| **Skills** | 浏览技能市场 | ✅ | ✅ | |
| | 调用技能 | ✅ | ✅ | |
| | 创建个人技能 | ✅ | ✅ | 服务端沙箱 |
| | 提交企业技能 | ✅ | ✅ | |
| **Memory** | 历史会话 | ✅ | ✅ | |
| | 跨会话记忆 | ✅ | ✅ | |
| | 本地记忆 | ❌ | ✅ | DuckDB |
| **MCP** | 远程 MCP（SSE） | ✅ | ✅ | |
| | 服务端 stdio MCP | ✅ | ✅ | |
| | 本地 stdio MCP | ❌ | ✅ | 私有连接 |
| **文件** | 上传/下载 | ✅ | ✅ | |
| | 直接读写本地 | ⚠️ | ✅ | File API |
| | 拖拽支持 | ✅ | ✅ | |
| **集成** | 飞书内嵌 | ✅ | ⚠️ | iframe |
| | 钉钉内嵌 | ✅ | ⚠️ | |
| | 系统托盘 | ❌ | ✅ | |
| | 全局快捷键 | ❌ | ✅ | |
| | Auto-launch | ❌ | ✅ | |
| **离线** | 查看历史 | ⚠️ | ✅ | Service Worker |
| | 创建对话 | ❌ | ⚠️ | 仅缓存 |
| | 缓存 LLM 响应 | ⚠️ | ✅ | |
| **审计** | 写入审计 | ✅ | ✅ | 服务端 |
| | 不可篡改 | ✅ | ✅ | |
| | 离线审计 | ❌ | ✅ | 本地缓冲 |
| **安全** | SSO 登录 | ✅ | ✅ | |
| | 凭据加密 | ⚠️ Cookie | ✅ Keychain | |
| | RBAC | ✅ | ✅ | |
| | 端到端加密 | ⚠️ | ✅ | |
| **更新** | 自动更新 | ✅（即时） | ✅（重启后） | Web 优势 |
| | 无感升级 | ✅ | ⚠️ | Web 完美 |

**结论**：Web 版覆盖 80% 场景，Electron 补足剩余 20% 的"高级"能力。

---

## 附录 C · 设计 Token 规范

完整 Token 列表（供前端工程师直接使用）：

```typescript
// design/tokens.ts（完整版见 第 8 章）

export const tokens = {
  color: { /* 见第 8.2 节 */ },
  font: { /* 见第 8.2 节 */ },
  space: { /* 见第 8.2 节 */ },
  radius: { /* 见第 8.2 节 */ },
  shadow: { /* 见第 8.2 节 */ },
  motion: { /* 见第 8.2 节 */ },

  // 组件规范
  component: {
    button: {
      height: { sm: '28px', md: '36px', lg: '44px' },
      paddingX: { sm: '10px', md: '14px', lg: '18px' },
    },
    input: {
      height: { sm: '32px', md: '40px', lg: '48px' },
    },
    card: {
      padding: '20px',
      gap: '12px',
    },
    avatar: {
      size: { sm: '24px', md: '32px', lg: '40px', xl: '64px' },
    },
  },

  // 断点
  breakpoint: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },

  // z-index（避免无序）
  zIndex: {
    'dropdown': 1000,
    'sticky': 1100,
    'overlay': 1200,
    'modal': 1300,
    'popover': 1400,
    'toast': 1500,
    'tooltip': 1600,
  },
};
```

---

## 附录 D · 组件清单

P9.7（Design System）阶段需要交付的组件：

### 基础组件（11 个）

- [ ] Button（4 种 variant × 3 种 size）
- [ ] Input（text / search / textarea）
- [ ] Select（单选 / 多选）
- [ ] Checkbox / Radio / Switch
- [ ] Dropdown（菜单）
- [ ] Tooltip
- [ ] Popover
- [ ] Toast（4 种 variant）
- [ ] Modal / Drawer
- [ ] Tabs
- [ ] Avatar / Badge

### 业务组件（10 个）

- [ ] ChatMessage（用户/助手两种）
- [ ] ToolCallCard（折叠式）
- [ ] ThinkingPanel（思考过程展示）
- [ ] HitLApprovalDialog（审批弹窗）
- [ ] SkillCard（技能市场卡片）
- [ ] SkillFactoryWizard（5 步向导）
- [ ] CommandPalette（⌘K）
- [ ] CitationLink（引用链接）
- [ ] StatusIndicator（agent 状态）
- [ ] ConnectorCard（连接器卡片）

### 布局组件（5 个）

- [ ] Header
- [ ] Sidebar
- [ ] MainLayout
- [ ] AuthLayout
- [ ] EmptyState

### Storybook 文档

每个组件配套：
- 描述
- Props 说明
- 多个使用示例
- 可访问性说明
- 设计 token 引用

---

## 文档结尾

### 给项目维护者的话

v3.1 是 v3.0 的**精修版**，不是替代。三处修订都源于工程实践智慧：

1. **Web 优先**：避免被桌面化卡死，让团队早交付价值
2. **跨平台**：把 Windows 内网这个"硬骨头"提前考虑
3. **UI/UX**：好看的产品才有人用，差异化护城河

### 这两份文档怎么读？

- **新读者**：先看 v3.0（完整方案），再看 v3.1（修订点）
- **熟读者**：直接看 v3.1（重点是修订原因 + 设计系统）
- **执行者**：v3.1 第 12 章修订路线图是核心

### 后续可深入的话题

- 单页面线框图（Figma）
- Storybook 在线 demo
- Electron 与 Web 的 Storage Adapter 完整代码
- Windows MSI 打包详细脚本
- macOS 公证完整流程文档

---

**文档版本**：v3.1 增量补充
**完成日期**：2026 年 5 月 8 日
**字数统计**：约 18,000 字
**预计阅读时间**：1 小时
**与 v3.0 关系**：增量补充，不替代

