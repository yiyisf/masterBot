# masterBot 优化方案 · v3 最终版

## 企业员工 AI 助手 · 本地分发模式 · Claude Managed Hybrid

---

**版本**：v3.0 Final
**日期**：2026 年 5 月 8 日
**目标读者**：masterBot 项目维护者 / yiyisf
**核心定位**：
1. **企业员工 AI 助手**（非个人助手，非 SaaS）
2. **员工本地分发**（桌面应用 + 轻量中心服务）
3. **Claude Managed Hybrid**（Claude SDK 主路径 + 自研 Legacy 兜底）
4. **Skill Factory 一等公民**（客户端-服务端协同的技能工厂）

---

## 文档结构

```
第一部分：方案总览（决策依据 + 核心约束）
  · 第 1 章  战略定位与决策依据
  · 第 2 章  现状评估与缺口分析
  · 第 3 章  核心设计原则

第二部分：架构设计（What & Why）
  · 第 4 章  整体架构（10 层）
  · 第 5 章  本地分发关键设计
  · 第 6 章  Hybrid Agent 引擎
  · 第 7 章  Skill Factory 双端协同
  · 第 8 章  三轨升级体系
  · 第 9 章  企业身份与权限
  · 第 10 章 审计与合规
  · 第 11 章 网络与模型路由

第三部分：实施计划（How & When）
  · 第 12 章 14 个 Phase 详细路线图
  · 第 13 章 关键里程碑与决策点
  · 第 14 章 风险管理与回滚预案
  · 第 15 章 团队配置与资源估算

第四部分：附录
  · 附录 A  目录结构与文件组织
  · 附录 B  关键 API 与协议规范
  · 附录 C  技术选型对照表
  · 附录 D  参考资源
```

---

# 第一部分：方案总览

## 第 1 章 战略定位与决策依据

### 1.1 三轮定位演进

| 版本 | 定位 | 核心问题 |
|------|------|---------|
| v1.0 | 通用 Hybrid Agent | 假定用于个人助手，多渠道（Telegram/iMessage） |
| v2.0 | 企业员工助手平台 | SaaS 中心化部署，租户隔离、RBAC |
| **v3.0** | **企业员工助手 · 本地分发** | **桌面应用 + 轻量中心服务，零信任友好** |

定位转变的关键逻辑：
- **客户是企业**（B2B）→ 必须有 SSO/RBAC/审计
- **用户是员工**（千人量级）→ 必须能扩展和自定义
- **部署是本地**（桌面应用）→ 数据所有权 + 离线能力 + 零中心运维
- **能力要可扩展**（Skill Factory）→ 员工可自助创建技能

### 1.2 为什么选择本地分发模式

对比中心化 SaaS 模式的关键优势：

| 维度 | SaaS 模式 | 本地分发模式（选择） |
|------|----------|-------------------|
| 数据归属 | 公司服务器 | **员工电脑（零信任友好）** |
| 离线能力 | 不可用 | **可离线（仅 LLM 调用需联网）** |
| 算力成本 | 服务器扩容 | **员工 PC 本地资源** |
| 中心服务器规模 | 几十个微服务 | **3-5 个轻量服务** |
| 启动速度 | 网络往返 | **毫秒级本地响应** |
| 适应 AI PC 趋势 | 不匹配 | **完全匹配 2026 趋势** |
| 主要挑战 | 扩缩容、SLA | **升级管理、审计回传** |

挑战已在本方案中通过 **三轨升级体系** + **审计异步回传** 解决。

### 1.3 关键约束

1. **现有架构资产**：保留 90% 的现有代码（SKILL.md 协议、MCP、连接器、Webhook、Runbook、DAG）
2. **技术栈连续性**：Node 22 + TypeScript + Next.js 16 + node:sqlite 全部保留
3. **Hybrid 模型支持**：Anthropic 走 Claude SDK，OpenAI/Gemini/Ollama 走自研引擎
4. **Skill Factory 不弱化**：员工自助创建技能能力是核心差异化点

---

## 第 2 章 现状评估与缺口分析

### 2.1 masterBot 现状（强项）

通过审阅项目，已具备的能力：

| 维度 | 现状 | 业界对标 |
|------|------|---------|
| Agent Loop | 自研 ReAct，async generator 流式输出 | LangGraph / Claude SDK |
| 多 LLM | OpenAI / Anthropic / Gemini / Ollama 适配 | LiteLLM 风格 |
| Skills 协议 | SKILL.md + YAML + index.ts 热重载 | Anthropic Skills 兼容 |
| MCP 支持 | stdio / SSE 双传输 | MCP 标准实现 |
| 记忆系统 | 短期 LRU + 长期向量 + 知识图谱 | Letta + GraphRAG |
| 任务编排 | DAG Executor 并行 | Plan-and-Execute |
| 多 Agent | Supervisor + Worker (SOUL.md) | Anthropic Subagents 雏形 |
| 追踪 | SpanRecorder | OTel 雏形 |
| 审批 | 飞书/钉钉 HitL 卡片 | Claude SDK canUseTool |
| 沙箱 | Shell 黑白名单 | Claude Code Bash sandbox |
| Skills 自动生成 | Auto-Skill Generator | Skill Factory 雏形 |
| 前端 | Next.js 16 + @assistant-ui/react | CopilotKit 雏形 |

**结论**：项目已独立"重新发明"了 Claude Agent SDK 的大部分核心抽象，方向正确，但继续自研每个原语 ROI 在下降。

### 2.2 关键缺口（针对本地分发企业版）

| 缺口 | 严重度 | 解决章节 |
|------|--------|---------|
| 没有桌面应用打包 | P0 | 第 5 章 |
| 没有企业 SSO/SCIM 集成 | P0 | 第 9 章 |
| 没有 LLM Gateway，凭据落在客户端 | P0 | 第 11 章 |
| 没有应用自动升级机制 | P0 | 第 8 章 |
| 没有 Skill Sync 同步机制 | P0 | 第 8 章 |
| Skill Factory 仅 2 阶段，缺安全审核 | P1 | 第 7 章 |
| 没有租户/部门隔离 | P1 | 第 9 章 |
| 没有不可篡改审计日志 | P1 | 第 10 章 |
| 没有标准 OTel 追踪 | P2 | 第 10 章 |
| 没有 capability eval（仅 regression） | P2 | 第 12 章 |
| Agent Loop 自研维护成本高 | P2 | 第 6 章 |

---

## 第 3 章 核心设计原则

### 3.1 七大设计原则

**P1. Local-First, Cloud-Augmented（本地优先，云端增强）**
- 数据存储、agent 执行、技能加载默认在本地
- 仅 LLM 调用、技能同步、审计回传需要云端
- 离线时仍可用（缓存的能力）

**P2. Hybrid by Design（Hybrid 是顶层架构）**
- AgentRouter 抽象层让 Claude SDK 与 Legacy 引擎并存
- Anthropic provider 走 SDK，享受 caching/compaction/subagent
- 其他 provider 走 Legacy，保护多 LLM 用户

**P3. Defense in Depth（深度防御）**
- 5 层权限评估（Hooks → Deny → Mode → Allow → canUseTool）
- 三方权限交集（user × agent × tool）
- 凭据从不落地员工 PC（LLM Gateway 集中持有）

**P4. Skill Factory as First-Class Citizen（技能工厂一等公民）**
- 员工对话即可创建技能
- 客户端段（个人草稿）+ 服务端段（企业评审）双段流水线
- 每个技能有完整生命周期（8 个状态）

**P5. Three-Track Updates（三轨升级）**
- Track 1：应用本体（4-6 周一次，灰度）
- Track 2：技能（随时，沙箱执行）
- Track 3：配置（即时，热更新）
- 三轨独立、互不阻塞

**P6. Audit-First, Privacy-Balanced（审计优先，隐私平衡）**
- 所有操作不可篡改记录
- 默认仅上报元数据，完整 prompt 留本地
- 调查时按需提取

**P7. Migrate, Don't Rewrite（迁移而非重写）**
- 90% 现有代码保留
- 通过抽象层（IAgent / IChannel / MemoryRouter）适配
- 灰度切换，永远可回滚

### 3.2 不做什么（明确边界）

- ❌ **不做 SaaS 中心化**：避免拖慢推进
- ❌ **不做完整 LLM 训练**：仅做 RAG + Prompt
- ❌ **不做硬编码渠道**：必须通过 IChannel 抽象
- ❌ **不在客户端持有 API Key**：所有凭据集中在 LLM Gateway
- ❌ **不让员工绕过权限**：本地策略文件必须服务端签名

---

# 第二部分：架构设计

## 第 4 章 整体架构（10 层）

### 4.1 总体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│ 员工 PC 上的 masterBot Desktop（Electron 应用）                    │
│                                                                  │
│ L1 · Frontend 层（前端）                                          │
│ ├─ Next.js 16 + AG-UI 协议                                       │
│ ├─ @assistant-ui/react 复用                                      │
│ ├─ 系统托盘 / 全局快捷键 / 通知                                    │
│ └─ Skill Factory UI（员工自助创建）                               │
│                                                                  │
│ L2 · Local Gateway（本地网关）                                    │
│ ├─ Fastify 进程内嵌                                              │
│ ├─ AG-UI 事件流（SSE/WS）                                        │
│ ├─ /api/sessions/{id}/{fork|resume|checkpoint}                  │
│ └─ /api/skills/{factory|sync}                                   │
│                                                                  │
│ L3 · ★ AgentRouter（路由抽象层）                                  │
│ ├─ IAgent 接口                                                   │
│ ├─ Anthropic → ClaudeManagedAgent (SDK)                          │
│ ├─ OpenAI/Gemini/Ollama → LegacySelfHostedAgent                  │
│ └─ FeatureFlag 灰度                                              │
│                                                                  │
│ L4 · Agent Implementations（双引擎）                              │
│ ├─ ClaudeManagedAgent（@anthropic-ai/claude-agent-sdk）          │
│ └─ LegacySelfHostedAgent（保留现有 ReAct）                        │
│                                                                  │
│ L4.5 · Local Policy Engine（本地策略引擎）                        │
│ ├─ RBAC Resolver（应用服务端签名策略）                             │
│ ├─ 5 层权限评估                                                   │
│ ├─ Lethal Trifecta 检测                                          │
│ └─ Output Guardrail                                             │
│                                                                  │
│ L5 · Shared Infrastructure（共享基础设施）                         │
│ ├─ Hook System（12 事件）                                         │
│ ├─ Tool Registry（本地缓存）                                      │
│ ├─ Skills Registry（本地）                                        │
│ ├─ Subagent Defs（部门专家）                                      │
│ ├─ MCP Server Manager                                           │
│ ├─ Memory Router（4 层）                                          │
│ ├─ Connector Hub（YAML）                                         │
│ └─ Runbook Engine                                               │
│                                                                  │
│ L5.5 · ★ Local Skill Factory（客户端段）                          │
│ ├─ Conversation Spec Builder                                    │
│ ├─ LLM Synthesizer                                              │
│ ├─ Local Static Validator                                       │
│ ├─ Local Sandbox Tester                                         │
│ └─ Personal Skill Repo                                          │
│                                                                  │
│ L6 · Local Persistence（本地持久化）                               │
│ ├─ core.db（node:sqlite WAL）                                    │
│ ├─ vectors.duckdb（DuckDB + VSS）                                │
│ ├─ audit.db（独立 SQLite）                                       │
│ ├─ skills/（文件系统）                                            │
│ └─ cache/（LLM 响应缓存）                                          │
│                                                                  │
│ L7 · Update & Sync Engine（三轨升级）                             │
│ ├─ Track 1: electron-updater                                    │
│ ├─ Track 2: SkillSyncEngine                                     │
│ └─ Track 3: ConfigPoller                                        │
│                                                                  │
│ L8 · Telemetry（本地遥测）                                        │
│ ├─ OTel SDK（GenAI Conventions）                                 │
│ ├─ Local Audit Buffer                                           │
│ └─ Async Uploader                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                  ↕ HTTPS + SSO Token
┌─────────────────────────────────────────────────────────────────┐
│ 公司中心服务（轻量，1-2 台服务器即可）                              │
│                                                                  │
│ S1 · Identity Service（身份）                                     │
│ ├─ 公司 IdP 代理（OAuth/SAML）                                    │
│ ├─ Token Issuance & Refresh                                     │
│ └─ 设备指纹绑定                                                   │
│                                                                  │
│ S2 · ★ LLM Gateway（核心）                                        │
│ ├─ Anthropic / Bedrock / Vertex 路由                             │
│ ├─ 凭据管理（员工不持有）                                          │
│ ├─ DLP / PII 扫描                                                │
│ ├─ 速率限制（按员工）                                              │
│ └─ 成本归集                                                      │
│                                                                  │
│ S3 · ★ Skill Registry（核心）                                     │
│ ├─ Manifest API                                                 │
│ ├─ Version Management                                           │
│ ├─ Server-side Verify & Eval                                    │
│ ├─ Review Workflow                                              │
│ └─ Signature Service                                            │
│                                                                  │
│ S4 · Update Server（更新服务）                                    │
│ ├─ electron-updater 协议                                         │
│ ├─ 分阶段灰度                                                     │
│ └─ CDN（公司 OSS / Nexus）                                        │
│                                                                  │
│ S5 · Config Center（配置中心）                                    │
│ ├─ 策略热更新                                                     │
│ ├─ FeatureFlag                                                  │
│ └─ 签名服务                                                      │
│                                                                  │
│ S6 · Audit Aggregator（审计聚合）                                 │
│ ├─ 接收客户端审计回传                                              │
│ ├─ 验证签名 + Hash 链                                             │
│ └─ 导出 SIEM（Splunk / Datadog）                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 各层技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| L1 Frontend | Electron 36 + Next.js 16 + AG-UI | 复用现有 Web 代码，企业 IT 部署成熟 |
| L2 Local Gateway | Fastify 进程内嵌 | 现有架构 |
| L3 AgentRouter | TypeScript 自研抽象层 | 轻量，~200 行 |
| L4a SDK 引擎 | @anthropic-ai/claude-agent-sdk | 享受 Anthropic 维护红利 |
| L4b Legacy 引擎 | 现有 src/core/agent.ts | 保留兜底 |
| L4.5 Policy | OPA WASM 嵌入 | 轻量，策略文件可签名 |
| L5 Hooks | TypeScript 中间件链 | 与 SDK 协议对齐 |
| L6a 业务数据 | node:sqlite (WAL) | Node 22 内置，零依赖 |
| L6b 向量 | DuckDB + VSS extension | 单文件、无服务进程、列存性能好 |
| L6c 审计 | 独立 SQLite | 隔离防 corruption |
| L7 Update | electron-updater | 行业标准 |
| L8 Tracing | OTel + 本地 OTLP exporter | 标准协议 |
| S2 Gateway | agentgateway / Envoy | 开源、生产级 |
| S3 Registry | Fastify + PostgreSQL | 轻量 |
| S6 Aggregator | Fastify + ClickHouse | 时序事件 |

### 4.3 客户端 vs 服务端职责划分

| 职责 | 本地客户端 | 服务端 | 备注 |
|------|----------|-------|------|
| Agent 执行 | ✅ | ❌ | 完全在本地 |
| LLM 调用 | ❌ | ✅ | 经 Gateway 鉴权 |
| 个人技能创建 | ✅ | ❌ | 草稿仅本地 |
| 企业技能审核 | ❌ | ✅ | 集中合规 |
| RBAC 评估 | ✅（带签名策略） | ❌ | 在线/离线都能用 |
| 审计写入 | ✅ | ❌ | 永不阻塞 |
| 审计聚合分析 | ❌ | ✅ | 异步回传 |
| 配置 | ✅（本地缓存） | ✅（签名分发） | 客户端缓存 |

---

## 第 5 章 本地分发关键设计

### 5.1 Electron 选型论证

**选 Electron 的核心理由**：

| 因素 | Electron | Tauri | 决策 |
|------|---------|-------|------|
| 现有 TS 技术栈复用 | ✅ 直接 | ⚠️ 需学 Rust | Electron |
| Claude SDK 集成 | ✅ Node spawn 直接调用 | ⚠️ Rust 端起 Node 子进程复杂 | Electron |
| Next.js 16 嵌入 | ✅ 完整支持 | ⚠️ 需 SSG 模式 | Electron |
| node:sqlite 内置 | ✅ Node 22 原生 | ⚠️ Rust 端用 rusqlite | Electron |
| MCP 子进程管理 | ✅ child_process 直接 | ⚠️ tauri-plugin-shell | Electron |
| electron-updater | ✅ 行业标准、差分更新 | ⚠️ 整包下载 | Electron |
| MSI/SCCM 推送 | ✅ 完整 | ⚠️ 不支持 MSIX | Electron |
| 包大小 | 130MB（可接受） | 5-10MB | 平局 |
| 内存占用 | 150MB（可优化） | 30MB | Tauri 略优但不构成决定因素 |

**结论**：选 Electron。包大小和内存占用劣势可接受，技术栈复用和生态成熟度决定胜负。

### 5.2 数据存储设计

```
~/Library/Application Support/masterBot/    (macOS)
%APPDATA%/masterBot/                        (Windows)
~/.config/masterBot/                        (Linux)

├── data/                          # 业务数据
│   ├── core.db                    # SQLite WAL（会话/任务/连接器配置）
│   ├── vectors.duckdb             # DuckDB（向量记忆 + NL2SQL 缓存）
│   ├── kg.db                      # SQLite（知识图谱）
│   └── audit.db                   # 独立 SQLite（审计日志，append-only）
│
├── skills/                        # 技能仓库
│   ├── builtin/                   # 内置（随版本，只读）
│   ├── enterprise/                # 公司预置（Track 2 同步）
│   │   ├── manifest.json          # 当前版本清单
│   │   └── {skill-id}/
│   │       └── {version}/         # 版本化目录
│   └── personal/                  # 员工自创（仅本地）
│       └── {skill-id}/
│
├── cache/                         # 缓存
│   ├── llm/                       # LLM 响应缓存（按 prompt hash）
│   ├── prompts/                   # Prompt 模板缓存
│   └── connector_meta/            # 连接器元数据
│
├── config/                        # 配置
│   ├── identity.json.enc          # SSO token（OS keychain 加密）
│   ├── settings.json              # 用户偏好
│   └── policy.signed.json         # 服务端签名的策略文件
│
└── logs/                          # 日志
    ├── app.log                    # 应用日志
    └── crash/                     # Crash dumps
```

**为什么用 DuckDB 替代 pgvector**：

| 对比 | pgvector | DuckDB + VSS | 决策 |
|------|---------|--------------|------|
| 部署 | 需 PostgreSQL 服务进程 | 单文件嵌入 | DuckDB |
| 启动 | ~2 秒 | 毫秒级 | DuckDB |
| 性能 | 行存，向量需扩展 | 列存，原生向量优化 | DuckDB |
| SQL 分析 | 标准 PG 语法 | 标准 SQL + OLAP 优化 | DuckDB（NL2SQL 复用更好） |
| 内存占用 | ~200MB（PG 进程） | ~30MB（嵌入式） | DuckDB |

### 5.3 离线能力设计

**离线时仍可用的能力**：

| 能力 | 离线可用 | 实现方式 |
|------|---------|---------|
| 已加载的技能 | ✅ | 本地 skills/ 目录 |
| 历史会话查询 | ✅ | 本地 SQLite |
| 记忆检索 | ✅ | 本地 DuckDB |
| 本地工具（文件、Shell） | ✅ | 本地执行 |
| LLM 调用 | ❌ | 需要 Gateway，但本地缓存命中可降级 |
| 新技能创建 | ❌ | 需要 LLM 合成 |
| 技能同步 | ❌ | 网络恢复后补同步 |
| 审计上传 | ❌ | 网络恢复后批量上传 |

**离线降级策略**：
```typescript
class NetworkAwareAgent {
  async execute(input: AgentInput) {
    if (await this.network.isOnline()) {
      return this.fullExecute(input);
    }

    // 离线降级
    const cacheable = await this.checkLLMCache(input);
    if (cacheable) {
      return this.executeWithCache(input);
    }

    return {
      response: '当前网络不可用，仅可使用已缓存的能力。',
      degraded: true,
      pendingActions: [input],  // 网络恢复后重试
    };
  }
}
```

### 5.4 资源管理

**避免占用员工电脑过多资源**：

```typescript
// 主进程启动时配置
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

// 后台时自动降级
app.on('browser-window-blur', () => {
  agentRouter.setMode('background');  // 暂停非紧急任务
});

// CPU 限流
const cpuLimiter = new CPULimiter({ maxPercent: 30 });
agentRouter.setLimiter(cpuLimiter);
```

**典型资源占用目标**：
- 启动后 RAM：~200MB
- 活跃 agent 时 RAM：~400MB
- 后台 RAM：~150MB
- CPU 后台：< 5%
- 磁盘：< 1GB（含技能缓存）

---

## 第 6 章 Hybrid Agent 引擎

### 6.1 IAgent 抽象层

```typescript
// src/core/agent/types.ts
export interface IAgent {
  /**
   * 统一执行接口
   * Anthropic provider → ClaudeManagedAgent
   * 其他 provider → LegacySelfHostedAgent
   */
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;

  /**
   * Session 管理（SDK 路径原生支持，Legacy 模拟）
   */
  resume(sessionId: string): AsyncGenerator<AgentEvent>;
  fork(sessionId: string): Promise<string>;
  checkpoint(sessionId: string): Promise<string>;

  /**
   * 能力描述
   */
  capabilities(): AgentCapabilities;
}

// src/core/agent/router.ts
export class AgentRouter {
  constructor(
    private readonly claude: ClaudeManagedAgent,
    private readonly legacy: LegacySelfHostedAgent,
    private readonly featureFlag: FeatureFlagService,
  ) {}

  route(config: AgentConfig): IAgent {
    if (config.forceLegacy) return this.legacy;

    if (config.provider === 'anthropic') {
      const enabled = this.featureFlag.isEnabled('claude-sdk', config.userId);
      if (enabled) return this.claude;
    }

    return this.legacy;
  }
}
```

### 6.2 ClaudeManagedAgent 实现

```typescript
// src/core/agent/claude-managed.ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeManagedAgent implements IAgent {
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    const options: ClaudeAgentOptions = {
      // 通过 LLM Gateway 路由（本地客户端不持有 API Key）
      // ANTHROPIC_BASE_URL 环境变量在启动时设置
      model: input.model ?? 'claude-opus-4-7',
      maxTurns: 250,
      thinking: { type: 'enabled', budget_tokens: 8000 },

      // 本地 Skills 加载（progressive disclosure）
      settingSources: ['project'],

      // Hooks 配置（统一中间件）
      hooks: this.hookBuilder.build({
        sandbox: this.permissionEngine,
        observer: this.observer,
        memory: this.memory,
        audit: this.auditWriter,
      }),

      // Subagents（部门专家）
      agents: this.subagentBuilder.build(input.userContext),

      // MCP Servers（本地 + 企业）
      mcpServers: await this.mcpManager.list(),

      // 5 层权限评估
      canUseTool: async (toolName, toolInput) => {
        return this.permissionEngine.evaluate(toolName, toolInput, input);
      },

      // Session 管理
      sessionId: input.sessionId,
      resumeSessionId: input.resumeFrom,
    };

    for await (const message of query({
      prompt: input.message,
      options
    })) {
      yield this.translateToAgentEvent(message);
    }
  }
}
```

### 6.3 LegacySelfHostedAgent 演进

保留现有 `src/core/agent.ts`，但做三个升级：
1. **实现 IAgent 接口**（添加 fork/resume/checkpoint）
2. **使用统一 Hooks 系统**（替代散落的拦截逻辑）
3. **maxIterations 提升**（10 → 50）

---

## 第 7 章 Skill Factory 双端协同

### 7.1 整体架构

```
员工本地 (Client-Side Factory)
├─ Stage 1: UNDERSTAND       对话挖掘需求
├─ Stage 2: SYNTHESIZE       LLM 生成
├─ Stage 3a: LOCAL VERIFY    本地静态校验
├─ Stage 4a: LOCAL EVAL      本地沙箱测试
└─ 状态：personal-draft（仅本地，立即可用）
                  ↓
              员工"提交到企业"
                  ↓
公司中心 (Server-Side Factory)
├─ Stage 3b: SERVER VERIFY   服务端 SAST + SCA
├─ Stage 4b: SERVER EVAL     标准沙箱 + 影响分析
├─ Stage 4c: REVIEW          安全/合规人工评审
└─ Stage 5: PUBLISH          上架企业 Catalog
                  ↓
              Track 2 同步推送
                  ↓
          其他员工本地客户端
```

### 7.2 Skill 生命周期（8 状态）

```
┌─────────────┐    ┌──────────────────┐
│ 1. Drafting │ →  │ 2. Synthesizing  │  ← 客户端阶段
└─────────────┘    └──────────────────┘
                            ↓
                   ┌──────────────────┐
                   │ 3. Local-Tested  │  ← 仅本地可用
                   └──────────────────┘
                            ↓ （员工提交）
                   ┌──────────────────┐
                   │ 4. Pending Review│  ← 服务端阶段
                   └──────────────────┘
                            ↓
                   ┌──────────────────┐
                   │ 5. Approved      │  ← 5% 灰度
                   └──────────────────┘
                            ↓
                   ┌──────────────────┐
                   │ 6. Active        │  ← 全员可用
                   └──────────────────┘
                            ↓
                ┌─────────────────────────┐
                ↓                         ↓
     ┌──────────────────┐    ┌──────────────────┐
     │ 7. Deprecated    │    │ 8. Quarantined   │
     └──────────────────┘    └──────────────────┘
                ↓
     ┌──────────────────┐
     │ Archived (永久)  │
     └──────────────────┘
```

### 7.3 客户端 Skill Factory 关键代码

```typescript
// src/skill-factory/client.ts
export class LocalSkillFactory {
  /**
   * 员工对话场景：
   * "帮我做一个查 Jira 的技能"
   */
  async createFromConversation(
    intent: string,
    context: ConversationContext,
  ): Promise<LocalSkill> {
    // Stage 1: 反问澄清
    const spec = await this.specBuilder.build(intent, context, {
      maxRounds: 3,
      schemaTemplate: SKILL_SPEC_SCHEMA,
    });

    // Stage 2: LLM 生成
    const generated = await this.synthesizer.generate(spec, {
      output: ['SKILL.md', 'index.ts', 'tests/', 'references/'],
      style: 'enterprise-standard',
    });

    // Stage 3a: 本地验证
    const verified = await this.localValidator.check(generated, [
      'structure',           // 文件结构
      'metadata',            // YAML frontmatter
      'naming',              // 命名规范
      'hardcoded-secrets',   // 硬编码 key
      'permissions',         // 权限范围
    ]);

    if (!verified.passed) {
      return this.requestUserConfirm(generated, verified.warnings);
    }

    // Stage 4a: 本地沙箱测试
    const tested = await this.sandboxTester.run(generated, {
      testCases: spec.testCases,
      timeout: 30000,
      isolated: true,
    });

    // 安装到 personal/
    await this.installer.installPersonal(generated);

    return {
      ...generated,
      status: 'personal-draft',
      canShareToEnterprise: tested.score > 0.8,
      localTestResults: tested,
    };
  }

  /**
   * 提交到企业评审
   */
  async submitToEnterprise(
    skillId: string,
    targetScope: 'department' | 'tenant' | 'global',
  ): Promise<SubmissionResult> {
    const skill = await this.repo.get(skillId);

    // 加密敏感信息（公司密钥）
    const sanitized = await this.sanitizer.removeLocalReferences(skill);

    return this.registryClient.submit(sanitized, {
      submitter: this.identityService.getCurrentUser(),
      targetScope,
      localTestResults: skill.localTestResults,
    });
  }
}
```

### 7.4 服务端 Skill Registry 关键 API

```typescript
// 公司中心服务端
POST   /api/skills/submit              // 员工提交新技能
GET    /api/skills/manifest            // 获取当前 Manifest（客户端同步）
GET    /api/skills/{id}/versions       // 单个技能版本历史
GET    /api/skills/{id}/{version}      // 下载技能包
POST   /api/skills/{id}/review         // Reviewer 提交评审
POST   /api/skills/{id}/approve        // 批准
POST   /api/skills/{id}/quarantine     // 紧急隔离
PATCH  /api/skills/{id}/policy         // 更新 RBAC 策略
GET    /api/skills/catalog             // 浏览企业技能市场
```

### 7.5 Skill Manifest 协议

```json
{
  "manifestVersion": "2026.05.08T10:00:00Z",
  "tenantId": "acme-corp",
  "signature": "...",
  "skills": [
    {
      "id": "hr.employee-query",
      "name": "员工信息查询",
      "version": "1.4.2",
      "hash": "sha256:abc123...",
      "size": 24512,
      "scope": "department:hr",
      "minClientVersion": "1.5.0",
      "category": "query",
      "owner": "u-zhang",
      "approvedBy": "u-li",
      "approvedAt": "2026-04-30T...",
      "status": "active",
      "rolloutPercentage": 100,
      "previousVersion": null,
      "deprecation": null,
      "downloadUrl": "https://registry.corp.com/skills/hr.employee-query/1.4.2.zip",
      "signature": "..."
    }
  ]
}
```

### 7.6 Auto-Curator 自我进化

```typescript
// 服务端定时任务（每天凌晨）
class AutoCurator {
  async curate() {
    const skills = await this.registry.listActive();

    for (const skill of skills) {
      const stats = await this.metrics.aggregate(skill.id, '30d');

      if (stats.usage === 0) {
        await this.autoArchive(skill, '30天无调用');
      } else if (stats.errorRate > 0.3) {
        await this.flagForReview(skill, '错误率过高');
      } else if (stats.usage > 100 && stats.satisfaction > 0.9) {
        await this.markPremium(skill, '企业精选');
      }

      // 负向反馈触发新一轮 Skill 生成
      const negativeFeedback = await this.feedback.getNegative(skill.id);
      if (negativeFeedback.length > 5) {
        await this.triggerRegeneration(skill, negativeFeedback);
      }
    }
  }
}
```

---

## 第 8 章 三轨升级体系

### 8.1 三轨概览

| Track | 内容 | 频率 | 风险 | 用户感知 |
|-------|------|------|------|---------|
| **Track 1** | 应用本体（Electron + 核心代码） | 4-6 周 | 高 | 重启 |
| **Track 2** | 技能（Skill Catalog） | 随时 | 低 | 静默 |
| **Track 3** | 配置/策略 | 即时 | 极低 | 无感 |

### 8.2 Track 1：应用本体升级

**机制**：electron-updater + 公司 CDN

**配置**：
```typescript
// src/main/auto-updater.ts
import { autoUpdater } from 'electron-updater';

export class AppUpdater {
  initialize() {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `https://updates.corp.com/masterBot/${this.getChannel()}/`,
      channel: this.getChannel(),
    });

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.differentialDownload = true;
    autoUpdater.allowDowngrade = false;

    // 强制升级检查
    autoUpdater.on('update-available', async (info) => {
      const policy = await this.policyService.get();
      if (this.compareVersion(app.getVersion(), policy.minVersion) < 0) {
        // 强制升级
        await autoUpdater.downloadUpdate();
        autoUpdater.quitAndInstall();
      }
    });

    // 每 4 小时检查一次
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 3600 * 1000);
  }

  private getChannel(): 'stable' | 'beta' | 'alpha' {
    const userId = this.identity.getCurrentUser().id;
    const bucket = simpleHash(userId) % 100;
    const config = this.configService.get('updateChannels');

    if (bucket < config.alpha) return 'alpha';
    if (bucket < config.alpha + config.beta) return 'beta';
    return 'stable';
  }
}
```

**灰度策略**：
1. **alpha**（5%）：内部员工 + 早期 adopter，每周发布
2. **beta**（25%）：扩展员工，2 周发布
3. **stable**（70%）：所有员工，4-6 周发布

**强制升级条件**：
- 修复严重安全漏洞
- 协议不兼容变更
- LLM Gateway 协议升级

### 8.3 Track 2：Skill Sync 引擎（核心创新）

```typescript
// src/skills/sync-engine.ts
export class SkillSyncEngine {
  private syncInterval = 3600 * 1000; // 1 小时
  private lastManifestHash: string | null = null;

  async start() {
    await this.syncOnce();
    setInterval(() => this.syncOnce(), this.syncInterval);

    // 启动时立即同步
    app.on('ready', () => this.syncOnce());
  }

  async syncOnce(): Promise<SyncResult> {
    try {
      // 1. 拉取 Manifest（仅当变化时下载）
      const manifest = await this.fetchManifest({
        ifNoneMatch: this.lastManifestHash,
      });

      if (!manifest) return { changed: false };  // 304 Not Modified

      this.lastManifestHash = manifest.hash;

      // 2. 对比本地
      const local = await this.scanLocalSkills();
      const changes = this.diff(manifest, local);

      // 3. 应用变更
      for (const change of changes) {
        await this.applyChange(change);
      }

      // 4. 上报同步成功
      await this.telemetry.report('skill_sync_success', {
        applied: changes.length,
      });

      return { applied: changes.length };
    } catch (e) {
      this.logger.error('Skill sync failed', e);
      // 失败不影响应用使用
      return { error: e.message };
    }
  }

  private async applyChange(change: SkillChange) {
    switch (change.type) {
      case 'install':
      case 'upgrade':
        if (!this.isInRollout(change.skill)) return;
        await this.atomicInstall(change.skill);
        break;

      case 'remove':
        await this.archiveSkill(change.skillId);
        break;

      case 'deprecate':
        await this.markDeprecated(change.skillId);
        break;

      case 'quarantine':
        // 紧急隔离，立即停用
        await this.disableImmediately(change.skillId);
        break;
    }
  }

  private async atomicInstall(skill: SkillManifest) {
    const targetDir = path.join(this.skillsDir, 'enterprise', skill.id);

    // 1. 下载到临时目录
    const tmpDir = await this.downloadAndExtract(skill);

    // 2. 验证签名
    await this.verifySignature(tmpDir, skill.hash, skill.signature);

    // 3. 静态校验（防御层）
    await this.runPreflightChecks(tmpDir);

    // 4. 原子切换
    const next = `${targetDir}.next`;
    const prev = `${targetDir}.prev`;

    await fs.move(tmpDir, next);
    if (await fs.exists(targetDir)) await fs.move(targetDir, prev);
    await fs.move(next, targetDir);

    // 5. 7 天回滚窗口
    await this.scheduleCleanup(prev, 7 * 86400);

    // 6. 通知 Agent 重新加载
    this.eventBus.emit('skill:reloaded', { skillId: skill.id });
  }

  private isInRollout(skill: SkillManifest): boolean {
    if (skill.rolloutPercentage === 100) return true;
    const userId = this.identity.getCurrentUser().id;
    const bucket = simpleHash(userId + skill.id) % 100;
    return bucket < skill.rolloutPercentage;
  }
}
```

**关键特性**：
- **增量同步**：仅当 Manifest hash 变化时下载
- **原子切换**：失败不会破坏旧版本
- **7 天回滚窗口**：保留 .prev 目录
- **沙箱预检**：服务端校验过仍然在客户端二次校验
- **不阻塞应用**：同步失败不影响使用现有技能

### 8.4 Track 3：配置热更新

```typescript
// src/config/poller.ts
export class ConfigPoller {
  private pollInterval = 5 * 60 * 1000; // 5 分钟
  private lastConfigVersion: string | null = null;

  async start() {
    await this.pollOnce();
    setInterval(() => this.pollOnce(), this.pollInterval);
  }

  async pollOnce() {
    try {
      const config = await this.fetchConfig({
        ifNoneMatch: this.lastConfigVersion,
      });

      if (!config) return;  // 304

      // 验证签名
      await this.verifySignature(config);

      // 应用变更
      this.lastConfigVersion = config.version;
      this.applyConfig(config);

      // 通知监听者
      this.eventBus.emit('config:updated', config);
    } catch (e) {
      this.logger.warn('Config poll failed', e);
    }
  }

  private applyConfig(config: PolicyConfig) {
    // Agent 参数
    this.agentRouter.setMaxIterations(config.agent.maxIterations);
    this.agentRouter.setModel(config.agent.model);

    // 权限策略
    this.permissionEngine.updateRules(config.rbac);

    // Guardrails
    this.guardrails.update(config.guardrails);

    // FeatureFlag
    this.featureFlag.bulkSet(config.features);
  }
}
```

### 8.5 失败回滚与降级

| Track | 失败检测 | 自动恢复 |
|-------|---------|---------|
| Track 1 | 启动失败 / Crash | 启动器记录"上次成功版本"，连续失败自动回退 |
| Track 2 | 沙箱测试失败 / 用户点踩率高 | mv `*.prev` → `*` 恢复 |
| Track 3 | 配置解析失败 / 签名错误 | 使用上次成功配置 + 上报 |

---

## 第 9 章 企业身份与权限

### 9.1 身份模型

```
人类用户身份（来自企业 IdP）
├─ user_id (SSO)
├─ department (SCIM 同步)
├─ roles[]
└─ groups[]

Agent 身份（每个 agent 实例）
├─ agent_id (加密生成)
├─ agent_role (hr-bot/it-helper/...)
├─ tenant
├─ capabilities[]
└─ owner (人类负责人)

工具/资源权限（Tool Registry）
├─ tool_id
├─ required_scopes[]
├─ data_classification
├─ approval_level
└─ audit_severity
```

**最终授权公式**：
```
allow = user.scopes ∩ agent.capabilities ∩ tool.required_scopes
```

### 9.2 SSO 集成流程

```
员工首次启动 masterBot Desktop
  ↓
打开浏览器，跳转公司 IdP（OAuth/SAML）
  ↓
员工登录（公司账号 + MFA）
  ↓
IdP 回调，本地服务接收 code
  ↓
换取 access_token + refresh_token
  ↓
存储到 OS keychain（safeStorage 加密）
  ↓
后续所有请求带 Bearer token
  ↓
LLM Gateway 验证 token，应用 RBAC
```

**关键代码**：
```typescript
// src/main/auth/sso.ts
import { safeStorage, BrowserWindow } from 'electron';

export class SSOAuthenticator {
  async login(): Promise<AuthResult> {
    const authUrl = `${IDP_URL}/oauth/authorize?` +
      `client_id=${CLIENT_ID}&` +
      `redirect_uri=http://localhost:${this.port}/callback&` +
      `response_type=code&` +
      `scope=openid+profile+email+groups`;

    // 打开浏览器
    shell.openExternal(authUrl);

    // 监听回调
    const code = await this.listenForCallback();

    // 换取 token
    const tokens = await this.exchangeCode(code);

    // 加密存储
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    await fs.writeFile(this.tokenPath, encrypted);

    return { user: tokens.user };
  }

  async getAccessToken(): Promise<string> {
    const encrypted = await fs.readFile(this.tokenPath);
    const tokens = JSON.parse(safeStorage.decryptString(encrypted));

    if (this.isExpired(tokens.access_token)) {
      return this.refresh(tokens.refresh_token);
    }

    return tokens.access_token;
  }
}
```

### 9.3 5 层权限评估

```typescript
// src/permissions/engine.ts
export class PermissionEngine {
  async evaluate(
    toolName: string,
    toolInput: any,
    context: AgentContext,
  ): Promise<PermissionDecision> {
    // Layer 1: Hooks（已在 PreToolUse 处理）

    // Layer 2: Deny Rules（绝对禁止，签名策略文件）
    if (this.matchesDenyRule(toolName, toolInput)) {
      return { behavior: 'deny', reason: 'Blocked by deny rule' };
    }

    // Layer 3: Permission Mode
    const mode = this.getPermissionMode(context.userId);
    if (mode === 'plan') {
      return { behavior: 'deny', reason: 'Plan mode: read-only' };
    }
    if (mode === 'bypassPermissions') {
      return { behavior: 'allow' };
    }

    // Layer 4: Allow Rules（白名单）
    if (this.matchesAllowRule(toolName, toolInput, context)) {
      return { behavior: 'allow' };
    }

    // Layer 5: Lethal Trifecta 检测
    if (this.detectLethalTrifecta(toolName, context.activeTools)) {
      return this.requestHumanApproval({
        toolName,
        toolInput,
        reason: 'Lethal trifecta detected: private + untrusted + external',
        requiredLevel: 'security',
      });
    }

    // Layer 5: 工具级审批
    const annotation = this.getToolAnnotation(toolName);
    if (annotation.destructiveHint || annotation.openWorldHint) {
      return this.requestHumanApproval({
        toolName,
        toolInput,
        annotation,
        requiredLevel: annotation.approvalLevel ?? 'peer',
      });
    }

    return { behavior: 'allow' };
  }

  private detectLethalTrifecta(
    toolName: string,
    activeTools: string[],
  ): boolean {
    const all = [...activeTools, toolName];
    const reads_private = all.some(t =>
      t.includes('hris') || t.includes('email.read') || t.includes('docs.read')
    );
    const exposes_untrusted = all.some(t =>
      t.includes('webfetch') || t.includes('webSearch') || t.includes('email.read')
    );
    const sends_external = all.some(t =>
      t.includes('send') || t.includes('post') || t.includes('publish')
    );
    return reads_private && exposes_untrusted && sends_external;
  }
}
```

### 9.4 部门隔离

每个员工的本地客户端只加载属于其部门的技能：

```typescript
// 同步技能时按 scope 过滤
const userScopes = identity.getCurrentUser().scopes;
// e.g. ['department:hr', 'role:manager']

const visibleSkills = manifest.skills.filter(skill =>
  this.matchesScope(skill.scope, userScopes)
);
```

### 9.5 离线策略文件签名

服务端签名策略文件，客户端无法篡改：

```typescript
// 服务端签名
const signed = {
  policy: { /* ... */ },
  signature: signWithPrivateKey(policy, SERVER_PRIVATE_KEY),
  expiresAt: Date.now() + 7 * 86400 * 1000,
};

// 客户端验证
const valid = verifyWithPublicKey(
  policy.signature,
  policy.policy,
  SERVER_PUBLIC_KEY,  // 内置在应用包中
);
if (!valid || policy.expiresAt < Date.now()) {
  // 拒绝执行，强制升级或重新认证
}
```

---

## 第 10 章 审计与合规

### 10.1 本地审计设计

**核心原则**：审计永不阻塞 agent 执行

```typescript
// src/audit/local-writer.ts
export class LocalAuditWriter {
  private buffer: AuditEvent[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * 同步写入（永不抛异常，失败回退到内存缓冲）
   */
  write(event: AuditEvent): void {
    // 添加 hash 链
    const previous = this.lastHash || '';
    event.hash = sha256(JSON.stringify(event) + previous);
    this.lastHash = event.hash;

    // 异步刷盘（不阻塞）
    this.writeChain = this.writeChain.then(() =>
      this.writeToDB(event).catch(err => {
        this.buffer.push(event);  // 内存缓冲
        this.logger.error('Audit write failed', err);
      })
    );
  }

  private async writeToDB(event: AuditEvent) {
    await this.db.run(
      `INSERT INTO audit_log
       (id, timestamp, user_id, agent_id, tool_name,
        tool_input_hash, decision, prev_hash, hash, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.id, event.timestamp, event.userId, event.agentId,
       event.toolName, event.toolInputHash, event.decision,
       event.prevHash, event.hash, event.signature]
    );
  }
}
```

### 10.2 异步回传机制

```typescript
// src/audit/uploader.ts
export class AuditUploader {
  async start() {
    // 每 5 分钟批量上传
    setInterval(() => this.uploadBatch(), 5 * 60 * 1000);

    // 应用退出前最后一次上传
    app.on('before-quit', () => this.uploadBatch());
  }

  async uploadBatch() {
    const pending = await this.db.all(
      `SELECT * FROM audit_log
       WHERE uploaded = 0
       ORDER BY timestamp ASC
       LIMIT 1000`
    );

    if (pending.length === 0) return;

    try {
      const response = await this.client.post('/api/audit/batch', {
        events: pending,
        deviceFingerprint: this.deviceId,
      });

      // 服务端验证 hash 链完整性
      if (response.valid) {
        await this.db.run(
          `UPDATE audit_log SET uploaded = 1
           WHERE id IN (${pending.map(() => '?').join(',')})`,
          pending.map(e => e.id)
        );
      }
    } catch (e) {
      this.logger.warn('Audit upload failed, will retry', e);
    }
  }
}
```

### 10.3 审计内容分级

为平衡隐私与合规，审计数据分三级：

| 级别 | 内容 | 上传策略 |
|------|------|---------|
| **Metadata** | 时间、用户、工具名、决策、hash | 默认实时上传 |
| **Structured** | 工具入参（脱敏）、影响范围 | 调查时按需提取 |
| **Full Trace** | 完整 prompt、response、思考过程 | 仅在严重事件时提取（员工授权） |

### 10.4 防员工绕过

三道防线确保员工无法绕过审计：

1. **凭据隔离**：员工不持有 API Key，所有 LLM 调用必经 LLM Gateway
2. **进程完整性校验**：启动时验证应用签名
3. **本地审计 hash 链**：员工删除审计日志会破坏 hash 链，服务端能检测

### 10.5 OTel 集成

```typescript
// src/observability/otel.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const tracer = trace.getTracer('masterBot', app.getVersion());

// GenAI Semantic Conventions
export class OtelObserver {
  startAgentSpan(input: AgentInput) {
    return tracer.startSpan('agent.run', {
      attributes: {
        'gen_ai.system': input.provider,
        'gen_ai.request.model': input.model,
        'gen_ai.operation.name': 'agent_loop',
        'agent.session_id': input.sessionId,
        'agent.user_id': input.userId,
        'agent.tenant_id': input.tenantId,
      },
    });
  }

  recordModelUsage(span: Span, usage: TokenUsage) {
    span.setAttributes({
      'gen_ai.usage.input_tokens': usage.input,
      'gen_ai.usage.output_tokens': usage.output,
      'gen_ai.usage.cache_read_input_tokens': usage.cacheRead ?? 0,
    });
  }
}
```

---

## 第 11 章 网络与模型路由

### 11.1 完整路由路径

```
员工本地 masterBot
  ↓ ANTHROPIC_BASE_URL=https://llm-gateway.corp.com
  ↓ Authorization: Bearer <SSO_token>
公司 LLM Gateway（集中部署）
  ├─ 验证 SSO token
  ├─ 应用速率限制（按员工）
  ├─ DLP 扫描（出站 prompt）
  ├─ 凭据注入（Anthropic API Key）
  ↓ HTTPS_PROXY=https://corp-proxy.corp.com（可选）
公司代理（TLS 检查）
  ↓
api.anthropic.com（或 Bedrock / Vertex）
```

### 11.2 LLM Gateway 设计

**关键能力**：

| 能力 | 实现 |
|------|------|
| 多 provider 路由 | Anthropic / Bedrock / Vertex / Foundry |
| 凭据管理 | API Key 仅存于 Gateway，员工本地无凭据 |
| 速率限制 | 按 user_id × tenant_id |
| DLP 扫描 | 出站 prompt 检测 PII / 敏感词 |
| 成本归集 | 按部门 / 用户 / 项目 |
| 审计 | 所有请求落库 |
| Failover | provider A 不可用时切 B |

**推荐实现**：基于 [agentgateway.dev](https://agentgateway.dev) 二次开发，或自研 Fastify 微服务。

### 11.3 代理支持

masterBot 客户端支持：

| 代理类型 | 支持度 | 配置方式 |
|---------|------|---------|
| HTTP/HTTPS 代理 | ✅ 完整 | 环境变量 + settings.json |
| TLS 检查代理（Zscaler 等） | ✅ 完整 | NODE_EXTRA_CA_CERTS |
| NTLM/Kerberos | ⚠️ 通过 cntlm | 本地翻译代理 |
| SOCKS | ❌ 不支持 | 需 HTTP-to-SOCKS 转换器 |
| PAC 文件 | ⚠️ 部分 | Electron 原生支持，SDK 需手动设置 |

**配置示例**：

```bash
# 客户端启动时由公司 MDM/SCCM 注入下面环境变量
HTTPS_PROXY=https://corp-proxy.corp.com:8443
NO_PROXY=localhost,127.0.0.1,*.corp.com
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem
ANTHROPIC_BASE_URL=https://llm-gateway.corp.com
```

### 11.4 模型配置差异

**当前 masterBot 与 Claude SDK 的差异**：

| 维度 | 当前 | Claude SDK | 处理 |
|------|------|-----------|------|
| 接口协议 | OpenAI 兼容 | Anthropic Messages | AgentRouter 路由 |
| 支持 provider | OpenAI/Anthropic/Gemini/Ollama | Anthropic/Bedrock/Vertex/Foundry | Hybrid 双引擎 |
| 模型 ID | `gpt-4o` | `claude-opus-4-7` | 配置区分 |
| Provider 切换 | 运行时 | 环境变量 | 启动时绑定 |

**推荐部署矩阵**：

| 场景 | 模型路径 |
|------|---------|
| 海外纯 Anthropic | SDK → LLM Gateway → Anthropic API |
| AWS 用户 | SDK → LLM Gateway → Bedrock VPC Endpoint |
| 国内合规 | Legacy → LLM Gateway → 国产模型（DeepSeek/通义） |
| 混合 | AgentRouter 按 provider 自动路由 |

---

# 第三部分：实施计划

## 第 12 章 14 个 Phase 详细路线图

### 12.1 总览

```
共 14 个 Phase，约 22 周（5.5 个月）

P0  准备工作                  1 周
P1  可观测性先行              1 周  ─┐
P2  Hooks 重构                2 周   │ Foundation
P2.5 Identity & Policy        2 周  ─┘
P3  ClaudeManagedAgent        2 周  ─┐
P4  Skills + Subagents        2 周   │ Hybrid Engine
P5  Session 高级特性          1 周  ─┘
P6  Memory 四层 + 隔离        2 周  ─┐
P7  企业 IM 一等公民          2 周   │ Enterprise
P8  Admin Console + AG-UI     2 周  ─┘
P9  评估金字塔                持续  ─┐
P9.5 Skill Factory 2.0        3 周   │ Skill Factory
P10 Electron 桌面打包         2 周  ─┐
P11 三轨升级体系              3 周   │ Local Distribution
P12 灰度发布与运营            持续  ─┘
```

### 12.2 Phase 详细说明

#### P0 · 准备工作（1 周）

**目标**：环境搭建 + 决策记录 + SDK 验证

**任务**：
- `#issue-1` 创建 docs/migration/ 目录，写第一个 ADR
- `#issue-2` 添加 @anthropic-ai/claude-agent-sdk 依赖
- `#issue-3` 跑通 SDK quickstart 单元测试
- `#issue-4` 团队培训：Harness Engineering 概念分享

**交付物**：
- ADR-001: Hybrid Architecture
- ADR-002: Local Distribution Strategy
- ADR-003: Tech Stack Selection
- 一个用 SDK 的 Hello World 测试通过

**风险**：低

---

#### P1 · 可观测性先行（1 周）

**目标**：先建立看见问题的能力

**任务**：
- `#issue-5` 引入 @opentelemetry/api + sdk-node
- `#issue-6` 定义 GenAI Semantic Conventions 字段
- `#issue-7` 替换 SpanRecorder → OtelObserver
- `#issue-8` 部署 Langfuse self-hosted（docker-compose）
- `#issue-9` 在 docs 中添加 trace 查看指南

**交付物**：所有现有功能在 Langfuse 上有完整 trace

**关键里程碑**：✅ 可以看见每次 agent 调用的全链路

**风险**：低

---

#### P2 · Hooks 重构（2 周）

**目标**：把 SDK 的 Hook 抽象引入项目

**任务**：
- `#issue-10` 设计 IAgent 接口
- `#issue-11` 把现有 agent.ts 重命名为 LegacySelfHostedAgent
- `#issue-12` 实现 AgentRouter（Hybrid 路由层）
- `#issue-13` 设计 Hook 系统（12 事件）
- `#issue-14` sandbox → PreToolUse Hook
- `#issue-15` IM 审批 → canUseTool 回调
- `#issue-16` Memory injection → SessionStart Hook
- `#issue-17` PII 脱敏 → PreToolUse Hook
- `#issue-18` 自动重试 → PostToolUseFailure Hook

**交付物**：测试 100% 通过，内部架构对齐 SDK

**关键里程碑**：✅ 现有功能不变，但 90% 业务逻辑已是 Hook 形态

**风险**：中（重构量大）

---

#### P2.5 · Identity & Policy Foundation（2 周）

**目标**：企业部署的硬前提

**任务**：
- `#issue-19` SSO/SAML 集成（OAuth 2.0）
- `#issue-20` SCIM provisioning（用户/部门同步）
- `#issue-21` 引入 OPA WASM 嵌入
- `#issue-22` 实现三方权限交集逻辑
- `#issue-23` Lethal Trifecta 检测
- `#issue-24` 服务端策略文件签名机制
- `#issue-25` Web UI: 登录页 + 权限提示

**交付物**：员工用真实工号登录使用

**关键里程碑**：✅ 能通过企业安全评审

**风险**：高（涉及企业 IT 配合）

---

#### P3 · ClaudeManagedAgent 上线（2 周）

**目标**：核心引擎切换

**任务**：
- `#issue-26` 实现 ClaudeManagedAgent 包装 SDK query()
- `#issue-27` 实现 createMasterBotMcpServer（现有 skills → SDK 可调）
- `#issue-28` SDK 消息流 → AgentEvent 转换器
- `#issue-29` Web Settings 增加 "Use Claude Managed" 开关
- `#issue-30` 灰度 5%，Langfuse 对比指标
- `#issue-31` 编写 capability eval 套件

**交付物**：5% 流量走 SDK，效果指标可对比

**关键里程碑**：✅ Claude Managed 路径通了，可以渐进放量

**风险**：高（关键切换）

---

#### P4 · Skills + Subagents 升级（2 周）

**目标**：Progressive Disclosure + Subagent 隔离

**任务**：
- `#issue-32` 把 skills/built-in/ 重组为 Anthropic Skills 格式
- `#issue-33` 改造 SKILL.md 用 Progressive Disclosure 写法
- `#issue-34` 实现 buildSubagents()
- `#issue-35` 部门专家 Subagent 库（HR/财务/IT/工程）
- `#issue-36` 测量 token 节省

**预期**：主 agent 平均 input tokens 减少 ≥30%

**风险**：中

---

#### P5 · Session 高级特性（1 周）

**目标**：fork / resume / checkpoint

**任务**：
- `#issue-37` 数据库 schema：sessions 增加 parent_id + sdk_session_id
- `#issue-38` 新表：session_checkpoints / file_checkpoints
- `#issue-39` /api/sessions/{id}/{fork|resume|checkpoint} 端点
- `#issue-40` Web UI: 增加 fork / resume / rewind 按钮

**交付物**：员工可以基于已有 session 试不同方案

**风险**：低

---

#### P6 · Memory 四层 + 租户隔离（2 周）

**目标**：Memory 重构 + 部门数据隔离

**任务**：
- `#issue-41` 抽象 MemoryRouter 接口
- `#issue-42` 引入 DuckDB + VSS extension
- `#issue-43` 实现 Procedural Memory（AGENTS.md 注入）
- `#issue-44` 实现 active compression
- `#issue-45` HitL 审批写入 Semantic Memory
- `#issue-46` 所有查询强制带 tenant_id 过滤

**交付物**：四层记忆体系上线

**风险**：中

---

#### P7 · 企业 IM 一等公民（2 周）

**目标**：飞书 / 钉钉 / 企微 / Teams 深度集成

**任务**：
- `#issue-47` IChannel 抽象接口
- `#issue-48` 飞书 channel 强化（已有）
- `#issue-49` 钉钉 channel 强化（已有）
- `#issue-50` 企业微信 channel
- `#issue-51` MS Teams channel（跨国企业）
- `#issue-52` 统一 HitL 卡片渲染协议

**交付物**：员工可在 IM 中无缝使用

**风险**：中（各家 API 差异大）

---

#### P8 · Admin Console + AG-UI（2 周）

**目标**：管理后台 + 前端协议升级

**任务**：
- `#issue-53` Admin Console: Skill 审批界面
- `#issue-54` Admin Console: RBAC 配置界面
- `#issue-55` Admin Console: 审计查询界面
- `#issue-56` Admin Console: 成本看板
- `#issue-57` AG-UI 协议替换 assistant-runtime

**交付物**：管理员可视化运营平台

**风险**：低

---

#### P9 · 评估金字塔（持续）

**目标**：建立三层评估体系

**任务**：
- `#issue-58` Tier 1: promptfoo 集成 + GitHub Actions
- `#issue-59` Tier 2: Langfuse Datasets + Shadow Traffic
- `#issue-60` Tier 3: FeatureFlag Canary 系统
- `#issue-61` 4 个 capability eval 套件
- `#issue-62` LLM-as-Judge 评分器

**交付物**：每次 PR 自动跑回归 eval

**关键里程碑**：✅ "evals are not optional"

**风险**：低（持续投入）

---

#### P9.5 · Skill Factory 2.0（3 周）

**目标**：把 Auto-Skill Generator 升级为完整闭环

**任务**：
- `#issue-63` Stage 1: NL Spec Builder（多轮反问）
- `#issue-64` Stage 2: Skill Synthesizer 升级（结构化生成）
- `#issue-65` Stage 3: Static Validator（结构 + 命名 + 元数据）
- `#issue-66` Stage 3: Security Scanner（Semgrep 集成）
- `#issue-67` Stage 4: Eval Harness（自动测试用例生成）
- `#issue-68` Stage 4: Sandbox Tester（隔离 Docker）
- `#issue-69` Stage 5: 服务端 Skill Reviewer 工作流
- `#issue-70` Stage 5: Skill Catalog UI
- `#issue-71` Auto-Curator 自我进化
- `#issue-72` Feedback Loop 负向反馈触发

**关键里程碑**：✅ 员工自助创建一个新技能，从需求到上线 < 2 小时

**风险**：高（功能复杂）

---

#### P10 · Electron 桌面打包（2 周）

**目标**：桌面应用形态

**任务**：
- `#issue-73` 引入 Electron 36 + electron-builder
- `#issue-74` 主进程架构：Main + Renderer + Worker
- `#issue-75` 进程内嵌 Fastify 改造
- `#issue-76` 系统托盘 + 全局快捷键
- `#issue-77` 通知系统集成
- `#issue-78` macOS / Windows / Linux 三端打包
- `#issue-79` 代码签名（公司证书）
- `#issue-80` Apple 公证 + Microsoft Defender 白名单
- `#issue-81` 启动性能优化（< 2 秒）
- `#issue-82` 资源占用优化（idle < 200MB RAM）

**交付物**：可独立分发的 .dmg / .msi / .deb

**关键里程碑**：✅ 一个员工能从下载安装到登录使用

**风险**：高（首次桌面化）

---

#### P11 · 三轨升级体系（3 周）

**目标**：解决本地分发的最大挑战

**任务**：

**Track 1（应用本体）**：
- `#issue-83` electron-updater 集成
- `#issue-84` 公司内部 CDN 配置
- `#issue-85` 灰度通道（alpha/beta/stable）
- `#issue-86` 强制升级机制
- `#issue-87` 启动失败回滚

**Track 2（Skill Sync）**：
- `#issue-88` Skill Manifest 协议
- `#issue-89` SkillSyncEngine 客户端
- `#issue-90` 服务端 Skill Registry API
- `#issue-91` 原子安装 + 7 天回滚窗口
- `#issue-92` 灰度推送

**Track 3（配置热更新）**：
- `#issue-93` ConfigPoller 客户端
- `#issue-94` 服务端 Config Center
- `#issue-95` 策略文件签名

**交付物**：员工无感升级

**关键里程碑**：✅ 90% 变更不需要重启应用

**风险**：高（机制复杂）

---

#### P12 · 灰度发布与运营（持续）

**目标**：稳健上线运营

**任务**：
- `#issue-96` 内测：10 人核心用户群
- `#issue-97` 小范围：1 个部门 50 人
- `#issue-98` 中范围：3 个部门 200 人
- `#issue-99` 全量：千人公司
- `#issue-100` 运营手册 + FAQ
- `#issue-101` 用户反馈渠道
- `#issue-102` 月度迭代节奏

**风险**：中

---

### 12.3 关键依赖图

```
P0 (准备)
 ↓
P1 (可观测) ← 必走
 ↓
P2 (Hooks) ← 必走
 ↓
P2.5 (Identity) ← 必走（企业前提）
 ↓
P3 (ClaudeManaged) ← 必走（关键切换）
 ↓
 ├─→ P4 (Skills/Subagents) ──┐
 ├─→ P5 (Session)            │
 ├─→ P6 (Memory)             │
 ├─→ P7 (IM)                 ├─→ P9.5 (Skill Factory 2.0) ─┐
 └─→ P8 (Admin)              │                              │
                              │                              │
P9 (Eval) ──持续──────────────┘                              │
                                                             ↓
                                              P10 (Electron) ─→ P11 (三轨) ─→ P12 (运营)
```

---

## 第 13 章 关键里程碑与决策点

### 13.1 五大里程碑

| 里程碑 | 时点 | 标志 | 决策点 |
|--------|------|------|--------|
| **M1** | P1 完成 | 看见每次 agent 调用 | 决定是否继续 P2 |
| **M2** | P3 完成 | Claude Managed 5% 跑通 | 决定 SDK 路径放量速度 |
| **M3** | P9.5 完成 | Skill Factory 2 小时上线 | 决定是否做内测 |
| **M4** | P10 完成 | 桌面应用可分发 | 决定内测范围 |
| **M5** | P12 启动 | 全量上线 | 决定后续迭代节奏 |

### 13.2 决策点详情

**M1 决策（P1 完成后）**：
- 如果 Langfuse 成本太高 → 选 Phoenix 自托管
- 如果 OTel 性能开销 > 5% → 调整 sampling 策略

**M2 决策（P3 完成后）**：
- 如果 SDK 路径效果优于 Legacy → 加速放量到 50%
- 如果效果持平 → 保持 5% 持续观察
- 如果效果劣化 → 暂停放量，定位原因

**M3 决策（P9.5 完成后）**：
- 如果生成的技能质量 > 80% 一次通过 → 直接进入 P10
- 如果质量低 → 加强 Stage 3+4 校验

**M4 决策（P10 完成后）**：
- 如果性能不达标 → 优化后再内测
- 如果跨平台问题多 → 优先 macOS/Windows，Linux 推后

**M5 决策（P12 启动）**：
- 内测反馈 NPS > 40 → 全量
- NPS < 40 → 修复后再扩展

---

## 第 14 章 风险管理与回滚预案

### 14.1 主要风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| SDK API 不稳定 | 中 | 中 | 锁定版本 + ADR 记录每次升级 |
| 企业 SSO 集成卡壳 | 高 | 高 | 提前与 IT 部门沟通，预留缓冲时间 |
| Claude SDK 效果不佳 | 中 | 中 | Legacy 路径永不下线 |
| Electron 性能不达标 | 中 | 中 | 早期 prototype 验证 |
| 三轨升级 bug | 低 | 高 | 内测充分，回滚机制完备 |
| Skill Factory 生成质量低 | 中 | 中 | 加强 Stage 3+4 校验 |
| 员工抗拒升级 | 中 | 中 | 渐进式：Track 3 → Track 2 → Track 1 |
| 国内合规问题 | 中 | 高 | 国内场景走 Legacy + 国产模型 |
| 数据库 corruption | 低 | 高 | WAL 模式 + 定期备份 + 独立 audit.db |
| 凭据泄露 | 低 | 严重 | OS keychain + LLM Gateway 中介 |

### 14.2 回滚策略

每个 Phase 都设计为可独立回滚：

| Phase | 回滚机制 |
|-------|---------|
| P1 (OTel) | feature flag 关闭 → 走老 SpanRecorder |
| P2 (Hooks) | 保留旧逻辑 6 个月，配置切换 |
| P3 (SDK) | AgentRouter 强制 Legacy |
| P4-P8 | 各自 feature flag |
| P10 (Electron) | 保留 Web 模式 12 个月 |
| P11 (升级) | 单 Track 失败不影响其他 Track |

### 14.3 紧急情况处置

```
严重 bug → P11 Track 3 即时下发"全员降级"配置
                ↓
           客户端拉取后立即生效
                ↓
        agent 切换到 Legacy + 禁用问题技能

严重安全漏洞 → 服务端发布 Quarantine 指令
                ↓
              客户端立即停用受影响技能
                ↓
              Track 1 强制升级补丁
```

---

## 第 15 章 团队配置与资源估算

### 15.1 团队建议

| 角色 | 人数 | 职责 | 阶段 |
|------|-----|------|------|
| **架构师** | 1 | 总体架构 + ADR 评审 | 全程 |
| **后端工程师** | 2-3 | Agent 引擎 + Skills + 服务端 | 全程 |
| **前端工程师** | 1-2 | Web Console + Admin + AG-UI | P8 起 |
| **桌面工程师** | 1 | Electron 打包 + 升级 | P10-P11 |
| **DevOps/SRE** | 1 | LLM Gateway + 部署 | P1 起 |
| **安全工程师** | 0.5 | RBAC + 审计 + 评审 | P2.5, P9.5 |
| **产品经理** | 0.5 | 需求 + 内测协调 | 全程 |

### 15.2 资源估算

**开发资源**（22 周）：
- 总人月：~50 人月
- 总成本：根据当地工资水平计算

**基础设施**（持续）：
- 中心服务器：2 台 4C8G（Skill Registry + LLM Gateway + Audit）
- CDN：公司内部 OSS（升级包分发）
- LLM Token：按使用量计算（建议初期月预算 $5K-$10K）
- Langfuse：self-hosted，1 台 4C16G

**第三方依赖**：
- Anthropic API 或 AWS Bedrock 账号
- 公司 IdP（已有）
- 代码签名证书：~$300/年（Windows）+ Apple Dev $99/年

### 15.3 时间线

```
Week 1-2:   P0 + P1
Week 3-4:   P2
Week 5-6:   P2.5
Week 7-8:   P3
Week 9-10:  P4
Week 11:    P5
Week 12-13: P6
Week 14-15: P7
Week 16-17: P8 + P9 (启动)
Week 18-20: P9.5
Week 21-22: P10
Week 23-25: P11
Week 26+:   P12 持续运营
```

---

# 第四部分：附录

## 附录 A · 目录结构

### A.1 客户端代码结构

```
masterBot/
├── electron/                      # Electron 主进程
│   ├── main.ts                    # 入口
│   ├── auto-updater.ts            # Track 1
│   ├── ipc-handlers.ts            # 渲染进程通信
│   ├── menu.ts                    # 应用菜单
│   ├── tray.ts                    # 系统托盘
│   └── window-manager.ts
│
├── src/
│   ├── core/
│   │   ├── agent/
│   │   │   ├── types.ts           # IAgent 接口
│   │   │   ├── router.ts          # AgentRouter
│   │   │   ├── claude-managed.ts  # ClaudeManagedAgent
│   │   │   └── legacy.ts          # LegacySelfHostedAgent
│   │   ├── hooks/
│   │   │   ├── index.ts
│   │   │   ├── sandbox.ts
│   │   │   ├── pii.ts
│   │   │   ├── memory.ts
│   │   │   ├── audit.ts
│   │   │   └── otel.ts
│   │   ├── permissions/
│   │   │   ├── engine.ts          # 5 层评估
│   │   │   ├── opa.ts             # OPA WASM
│   │   │   └── lethal-trifecta.ts
│   │   └── memory/
│   │       ├── router.ts
│   │       ├── working.ts
│   │       ├── episodic.ts
│   │       ├── semantic.ts
│   │       └── procedural.ts
│   │
│   ├── skills/
│   │   ├── registry.ts
│   │   ├── loader.ts
│   │   ├── progressive.ts
│   │   └── sync-engine.ts         # Track 2
│   │
│   ├── skill-factory/
│   │   ├── client.ts              # 客户端段
│   │   ├── spec-builder.ts        # Stage 1
│   │   ├── synthesizer.ts         # Stage 2
│   │   ├── local-validator.ts     # Stage 3a
│   │   ├── sandbox-tester.ts      # Stage 4a
│   │   └── registry-client.ts     # 提交到服务端
│   │
│   ├── subagents/
│   │   ├── index.ts
│   │   └── definitions/           # 部门专家
│   │       ├── hr-bot.ts
│   │       ├── finance-bot.ts
│   │       ├── it-helper.ts
│   │       └── researcher.ts
│   │
│   ├── mcp/
│   │   ├── manager.ts
│   │   ├── stdio-client.ts
│   │   └── sse-client.ts
│   │
│   ├── channels/                  # 企业 IM
│   │   ├── types.ts               # IChannel
│   │   ├── feishu.ts
│   │   ├── dingtalk.ts
│   │   ├── wecom.ts
│   │   └── teams.ts
│   │
│   ├── config/
│   │   ├── poller.ts              # Track 3
│   │   ├── policy-verifier.ts
│   │   └── feature-flag.ts
│   │
│   ├── auth/
│   │   ├── sso.ts                 # SSO 登录
│   │   ├── token-manager.ts
│   │   └── identity-service.ts
│   │
│   ├── audit/
│   │   ├── local-writer.ts        # 本地写入
│   │   ├── uploader.ts            # 异步回传
│   │   └── hash-chain.ts
│   │
│   ├── observability/
│   │   ├── otel.ts
│   │   └── exporter.ts
│   │
│   ├── api/                       # 本地 Fastify
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── chat.ts
│   │   │   ├── sessions.ts
│   │   │   ├── skills.ts
│   │   │   └── admin.ts
│   │   └── ag-ui-adapter.ts
│   │
│   ├── persistence/
│   │   ├── core-db.ts             # SQLite
│   │   ├── vectors-db.ts          # DuckDB
│   │   ├── audit-db.ts            # Audit SQLite
│   │   └── kg-db.ts               # 知识图谱
│   │
│   └── llm/
│       ├── gateway-client.ts      # LLM Gateway
│       └── cache.ts
│
├── web/                           # Next.js Renderer
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/
│   │       └── agui-runtime.ts    # AG-UI
│
├── .claude/
│   └── skills/                    # Anthropic Skills 格式
│       ├── shell-execution/
│       │   └── SKILL.md
│       ├── email-management/
│       └── ...
│
├── tests/
│   ├── unit/                      # vitest（regression）
│   └── evals/
│       ├── capability/            # promptfoo
│       └── regression/
│
├── docs/
│   ├── adr/                       # 架构决策记录
│   ├── migration/                 # 迁移指南
│   └── operations/                # 运维手册
│
├── electron-builder.yml           # 打包配置
├── tsconfig.json
└── package.json
```

### A.2 服务端代码结构

```
masterBot-server/                  # 公司中心服务（独立仓库）
├── services/
│   ├── identity/                  # S1
│   ├── llm-gateway/               # S2
│   ├── skill-registry/            # S3
│   ├── update-server/             # S4
│   ├── config-center/             # S5
│   └── audit-aggregator/          # S6
│
├── shared/
│   ├── types/                     # 与客户端共享类型
│   ├── proto/                     # 协议定义
│   └── crypto/                    # 签名工具
│
├── deploy/
│   ├── docker-compose.yml
│   └── k8s/                       # 可选 K8s 部署
│
└── docs/
```

---

## 附录 B · 关键 API 与协议规范

### B.1 IAgent 接口

```typescript
export interface AgentInput {
  message: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  model?: string;
  forceLegacy?: boolean;
  resumeFrom?: string;
}

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'state_update';
  data: any;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface IAgent {
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;
  resume(sessionId: string): AsyncGenerator<AgentEvent>;
  fork(sessionId: string): Promise<string>;
  checkpoint(sessionId: string): Promise<string>;
  capabilities(): AgentCapabilities;
}
```

### B.2 Skill Manifest Schema

```typescript
export interface SkillManifest {
  manifestVersion: string;          // ISO timestamp
  tenantId: string;
  signature: string;
  skills: SkillEntry[];
}

export interface SkillEntry {
  id: string;                       // 'hr.employee-query'
  name: string;
  version: string;                  // semver
  hash: string;                     // sha256
  size: number;
  scope: string;                    // 'department:hr'
  minClientVersion: string;
  category: string;
  owner: string;                    // 维护人
  approvedBy?: string;
  approvedAt?: string;
  status: SkillStatus;
  rolloutPercentage: number;
  previousVersion?: string;
  deprecation?: DeprecationInfo;
  downloadUrl: string;
  signature: string;
}

export type SkillStatus =
  | 'drafting'
  | 'synthesizing'
  | 'local-tested'
  | 'pending-review'
  | 'approved'
  | 'active'
  | 'deprecated'
  | 'archived'
  | 'quarantined';
```

### B.3 服务端 API

```
# Identity Service (S1)
POST   /api/auth/login              # 启动 SSO 流程
GET    /api/auth/callback           # OAuth 回调
POST   /api/auth/refresh            # 刷新 token
POST   /api/auth/logout

# LLM Gateway (S2)
POST   /v1/messages                 # Anthropic 协议代理
POST   /v1/chat/completions         # OpenAI 协议代理（Legacy）
GET    /v1/usage                    # 用量查询

# Skill Registry (S3)
POST   /api/skills/submit           # 提交新技能
GET    /api/skills/manifest         # 获取 Manifest
GET    /api/skills/{id}/{version}   # 下载技能包
POST   /api/skills/{id}/review
POST   /api/skills/{id}/approve
POST   /api/skills/{id}/quarantine

# Update Server (S4)
GET    /updates/{channel}/latest.yml
GET    /updates/{channel}/{version}/{platform}

# Config Center (S5)
GET    /api/config/policy           # 策略文件
GET    /api/config/features         # FeatureFlag

# Audit Aggregator (S6)
POST   /api/audit/batch             # 批量上传审计
```

### B.4 Hook 事件定义

```typescript
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Stop'
  | 'Notification';

export type HookCallback = (
  event: HookEventData,
  context: HookContext
) => Promise<HookResult>;
```

---

## 附录 C · 技术选型对照表

| 维度 | v1 选型 | v3 选型 | 变更原因 |
|------|--------|---------|---------|
| 桌面框架 | 无（Web） | **Electron 36** | 本地分发要求 |
| 业务数据库 | SQLite | **node:sqlite (WAL)** | Node 22 内置 |
| 向量数据库 | pgvector | **DuckDB + VSS** | 本地嵌入式 |
| 审计存储 | 同业务库 | **独立 SQLite** | 隔离防 corruption |
| Agent 引擎 | 自研 ReAct | **Hybrid (SDK + Legacy)** | 享受 SDK 红利 |
| 权限引擎 | 散落代码 | **OPA WASM 嵌入** | 策略即代码 |
| Hooks 系统 | 散落 | **统一 12 事件** | 与 SDK 协议对齐 |
| 追踪 | SpanRecorder | **OTel + Langfuse** | 标准协议 |
| 升级机制 | 无 | **三轨（Update/Sync/Config）** | 本地分发要求 |
| 身份 | API Key | **SSO + Gateway** | 企业要求 |
| 前端协议 | 自定义 SSE | **AG-UI** | 跨框架兼容 |

---

## 附录 D · 参考资源

### Anthropic 官方
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Claude Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Claude Agent SDK Skills](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Securely Deploying AI Agents](https://platform.claude.com/docs/en/agent-sdk/secure-deployment)
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Enterprise Network Configuration](https://code.claude.com/docs/en/network-config)

### 协议
- [MCP](https://modelcontextprotocol.io/)
- [A2A](https://github.com/a2aproject/A2A)
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui)
- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

### 开源参考实现
- [OpenClaw](https://github.com/openclaw/openclaw) — 多渠道个人助手
- [Letta (MemGPT)](https://github.com/letta-ai/letta) — 有状态 agent
- [agentgateway](https://github.com/agentgateway/agentgateway) — LLM Gateway
- [Langfuse](https://github.com/langfuse/langfuse) — 可观测性
- [promptfoo](https://github.com/promptfoo/promptfoo) — 评估框架

### Electron 桌面分发
- [electron-builder](https://www.electron.build/)
- [electron-updater](https://www.electron.build/auto-update)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

### 社区资源
- [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering)
- [Martin Fowler · Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [LangChain · Improving Deep Agents with Harness Engineering](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)

---

## 文档结尾

### 给项目维护者的话

这份方案不是一次性交付的"完美架构"，而是一份**演进路线图**。三个版本（v1 → v2 → v3）的每一次调整都源于你的真实约束：
- v1 假设是通用 agent，被你纠正为企业员工助手
- v2 假设是中心化 SaaS，被你纠正为本地分发
- v3 是这些纠正的最终落地

**最重要的三个建议**：

1. **先做 P1（可观测性）**——没有 trace 就没法做后续任何决策。1 周时间，价值最高。

2. **P2.5（Identity）和 P10（Electron）一定要早做 prototype 验证**——这两块是企业部署的硬骨头，很容易卡 1-2 周。早做 spike 可以暴露风险。

3. **Skill Factory 是你的护城河**——v2 图集里我把它升格为"核心保留"不是恭维。Cursor / Claude Code / Copilot 都不允许员工自助创建技能，这是 masterBot 真正的差异化。P9.5 三周投入是值得的。

### 后续支持

如果实施过程中遇到问题，可以就以下方面继续讨论：
- 单个 Phase 的实现细节（如 LLM Gateway 选型对比、Skill Synthesizer 的 prompt 设计）
- 跨 Phase 的接口定义（如 IAgent 完整规范、AG-UI 事件 schema）
- 组织协调问题（如 IT 部门 SSO 接入流程）
- 性能优化（如 Electron 启动速度、DuckDB 查询调优）

祝项目顺利！

---

**文档版本**：v3.0 Final
**完成日期**：2026 年 5 月 8 日
**字数统计**：约 32,000 字
**预计阅读时间**：2 小时
