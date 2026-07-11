# 研发流程管理模块 技术规格（Spec）

> **状态**：v1.0 定稿 — 由 wayfinder 规划流程产出
> **地图**：[研发流程管理工具技术规格地图 #52](https://github.com/yiyisf/masterBot/issues/52)（7 张决策 ticket 全部关闭）
> **日期**：2026-07-11
>
> 本文档汇总 7 项已定决议，作为实施的唯一依据。每节标注来源 ticket，实施中遇到歧义以对应 ticket 的决议 comment 为准。

---

## 1. 概述与定位

为 cmasterBot 新增「研发流程管理」模块：管理研发项目 → 同步/维护需求清单 → 指派编码 agent（claude code / codex / opencode / pi）在独立 worktree 中实施需求 → 处理执行中的人机问答 → 人工核验合并 PR → 全过程记录可回放。

**定位**（地图 Notes 决议）：cmasterBot 现有系统的新模块（新增前端页面 + 后端路由/数据表），**不是**独立服务。复用既有基础设施：

| 复用对象 | 用途 |
|---|---|
| `src/core/harness/`（agent-engine / agent-pool / session-store） | 编码 agent 执行引擎抽象 |
| `src/core/interrupt-coordinator.ts` | 人机问答中断（`waitForUserDecision` / `waitForApproval`） |
| `src/core/database.ts` 的 `session_events` 表（Phase 24） | 执行事件流落盘与回放 |
| `audit_approvals` 表 + `/audit` 页面 | 人工介入审计台账 |
| `src/skills/sandbox.ts` CommandSandbox | Bash 命令第二道闸 |

**核心术语**：

- **项目（Project）**：对应一个代码仓库的**主分支目录**。worktree 仅在需求研发过程发生时按需创建，不等同于项目。
- **需求（Requirement）**：项目下的一条研发事项，可同步自外部渠道（默认 GitHub issue）或手动创建。
- **执行（Run）**：针对一条需求发起的一次编码 agent 实施过程；重试产生新的 Run。

---

## 2. 需求数据模型与状态机（[#54](https://github.com/yiyisf/masterBot/issues/54)）

### 2.1 状态机（8 态）

```
synced ──► queued ──► in_progress ◄──► waiting_input
                          │
                          ├──► implemented ──► merged   ← 终态 = 真正完成
                          └──► failed ──► (人工重试回 queued)
任意活动态 ──► cancelled（人工中止）
```

- `waiting_input`：agent 等人工回答，前端高亮"需要你回答"
- `implemented`：agent 实施完成、PR 已建，**待人工核验合并**（当前阶段不自动合并；流程跑顺后未来可改自动）
- `merged`：PR 已合并，才算真正完成（唯一成功终态）
- `failed` 可人工重试；`cancelled` 对应现有 agent 终止能力

### 2.2 身份标识

- 主键：内部自生成 `id`
- **`req_key`（可读业务键，唯一索引）**：固定格式 `{project_name}#{数字id}`（如 `cmasterBot#42`）
  - 同步需求：数字 id = 渠道原始编号（GitHub issue number）
  - 手动需求：项目内自增序列，高位段/前缀（如 `M10001`）避免与 issue 号撞车
- 底层同步去重：`(project_id, source, source_key)` 唯一索引（防未来多渠道编号撞车）
- 再次同步：命中去重键**只更新元数据**（标题/描述/labels），**绝不回退状态**；远程 issue 关闭时置 `source_closed` 标记，不动状态机

### 2.3 requirements 表

```sql
CREATE TABLE requirements (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    req_key        TEXT NOT NULL,           -- {project_name}#{数字id}
    source         TEXT NOT NULL,           -- 'github' | 'manual' | 未来扩展
    source_key     TEXT NOT NULL,           -- 渠道内原始标识
    title          TEXT NOT NULL,
    description    TEXT,
    labels         TEXT,                    -- JSON array
    status         TEXT NOT NULL DEFAULT 'synced',
    source_url     TEXT,
    source_closed  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_req_key    ON requirements(req_key);
CREATE UNIQUE INDEX uq_req_dedup  ON requirements(project_id, source, source_key);
CREATE INDEX idx_req_project_status ON requirements(project_id, status);
```

### 2.4 SyncAdapter：代码接口注册

仿 `SkillSource`/`SkillRegistry` 多源模式（`src/skills/registry.ts`），**不走 YAML 声明式**（同步逻辑本质是代码）：

```ts
export interface RequirementSyncSource {
    readonly name: string;                                    // 'github' | ...
    fetchRequirements(project: Project, options: SyncOptions): Promise<RemoteRequirement[]>;
    testConnection?(project: Project): Promise<boolean>;
}
// 实现类注册进 SyncSourceRegistry；未来简单渠道可另写"通用 HTTP adapter"（自吃 YAML 配置）
```

### 2.5 默认 GitHub adapter

- **范围**：仅 open issue，排除 PR（按 `pull_request` 字段过滤）；项目级可配 label 过滤器，默认不过滤
- **字段映射**：`number→source_key`、`title`、`body→description`、`labels`、`html_url→source_url`
- **增量**：项目记 `last_synced_at` 水位线；首次全量拉 open，之后 `since=水位线&state=all`（捕获远程关闭 → `source_closed`）
- **仓库推断**：默认从项目目录 `git remote origin` 推断 owner/repo，项目配置可覆盖
- **触发**：仅手动触发（页面"⟳ 同步需求"按钮）；定时自动同步**不在本 spec 范围**（Out of scope）

---

## 3. 项目（Project）模型

```sql
CREATE TABLE projects (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,     -- req_key 前缀，唯一
    dir                 TEXT NOT NULL,            -- 主分支目录绝对路径
    description         TEXT,
    sync_source         TEXT NOT NULL DEFAULT 'github',
    sync_config         TEXT,                     -- JSON：label 过滤器、owner/repo 覆盖等
    last_synced_at      TEXT,
    max_concurrent_runs INTEGER NOT NULL DEFAULT 2,
    skills_installed_at TEXT,                     -- mattpocock/skills 安装时间（#56）
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
```

---

## 4. Worktree 生命周期（[#55](https://github.com/yiyisf/masterBot/issues/55)）

### 4.1 对应关系

- **1 需求 : 1 活跃 worktree**；分支命名固定 `req/{req_key 转义}`（`#` → `-`，如 `req/cmasterBot-42`）
- 失败重试**默认复用**同一 worktree（保留半成品与错误现场，断点续跑）；人工可显式"**重置重来**"（删 worktree + 分支后重建）
- 不允许同一需求并存多个 worktree；多次尝试历史靠执行记录（`requirement_runs`）追溯

### 4.2 物理位置与管理

- 服务端自建 **`WorktreeManager`**（直接 `git worktree add/remove`）；**不复用** Claude Code 的 `EnterWorktree`（交互式 CLI 工具，运行形态不同）
- 位置：项目主目录 `.cmaster/worktrees/{req_key转义}/`；`.cmaster/` 加入 gitignore
- worktree 路径作为 `cwd` 传给引擎（`EngineRunContext.cwd`，见 §5）
- 与 CLAUDE.md worktree 约定**语义层对齐**：不动 master、每需求独立分支出 PR、人工核验合并

### 4.3 清理规则（按状态）

| 状态 | 处理 |
|---|---|
| `merged` | **自动清理**：删 worktree 目录 + 本地分支（远程分支按 GitHub 仓库设置） |
| `implemented` | 必须保留（PR 未合；核验意见可能要求返工） |
| `failed` | 保留（重试复用现场） |
| `cancelled` | 保留，页面标记"可清理"，人工确认后删 |
| 兜底 | 项目级"清理孤儿 worktree"操作（需求已删/已终态但目录残留） |

### 4.4 重试与并发

- **重试人工触发**为主（agent 失败原因需人判断）；`retry_no` 记录在 run 上，未来自动重试只需加策略开关
- **并行**：项目级 `maxConcurrentRuns`（默认 2）；超限的需求停在 `queued` 按入队顺序自动起跑
- 需求优先级/依赖顺序/相互影响：**未来增强**（地图迷雾），v1 不做

---

## 5. 编码 Agent 引擎（[#53](https://github.com/yiyisf/masterBot/issues/53) + [#59](https://github.com/yiyisf/masterBot/issues/59)）

### 5.1 原则：扩展 IAgentEngine，不另起抽象

每个外部 CLI 一个 engine 实现，与既有 `ClaudeAgentSdkEngine` 并列；事件归一化 = 各 engine 把自家 CLI 事件转成现有 `ExecutionStep`（`_translateMessage()` 已示范）。**不造第二套事件模型**——`ExecutionStep` 的 interrupt 字段（`interruptKind: 'approval' | 'question'`，PR #50）已具备问答语义。harness / 前端 / 审计 / trace 全链路零改动。

### 5.2 接口定义

```ts
// src/core/harness/agent-engine.ts 扩展
export type AgentEngineKind = 'native' | 'claude-agent-sdk' | 'codex' | 'opencode' | 'pi';

export interface EngineCapabilities {
    /** 执行中能否编程式向人提问/请求审批（codex exec = false） */
    interactiveApproval: boolean;
    /** 能否跨进程恢复会话（v1 全部 false；Claude 未来 --resume） */
    resume: boolean;
}

export interface EngineRunContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    history?: Message[];
    abortSignal?: AbortSignal;
    traceId?: string;
    /** 新增：运行时工作目录（worktree 路径），优先于 spec.engineOptions.cwd */
    cwd?: string;
    /** 新增：审批模式，默认 'auto' */
    approvalMode?: 'auto' | 'ask-on-risky';
}

export interface IAgentEngine {
    readonly kind: AgentEngineKind;
    readonly capabilities: EngineCapabilities;   // 新增
    run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep>;
}
```

### 5.3 各引擎接入方式（#53 调研结论）

| 引擎 | 驱动方式 | interactiveApproval | 备注 |
|---|---|---|---|
| **claude-code**（默认） | Agent SDK `query()`（已集成于 `claude-sdk-engine.ts`） | ✅（`canUseTool` 回调） | 接入成本最低，默认引擎 |
| **codex** | `codex exec --json` + `--ask-for-approval never` + `workspace-write` | ❌（只能预设策略） | 显式降级，见 §5.5 |
| **opencode** | `opencode serve` HTTP API / ACP（`@opencode-ai/sdk`） | ✅（server 双向通道） | 回调形态需实现期实测 |
| **pi** | JSON-RPC 2.0 server over stdio | ✅（双向协议） | 文档最弱，需读源码实测 |

子 agent 折叠：各引擎的子 agent/subtask 以父级流程中的一步呈现（如 Claude 的 `Task` tool_use），内部不展开。

### 5.4 人机互动双通道

- **question 通道（常开）**：注入 `ask_user` 工具（Claude SDK 经 MCP 自定义工具）。时序：
  CLI 事件"需人工输入" → engine yield `{type:'interrupt', interruptKind:'question', interruptId, sessionId}` → `await waitForUserDecision(sessionId)` → 前端 `resolveInterrupt(sessionId, true, {text})` → 文本写回 CLI（stdin / SDK 工具结果）→ 继续流式 yield。需求状态同步切至 `waiting_input`。
- **approval 通道（默认关）**：`canUseTool` 沙箱自动判定，黑名单命中直接 deny（agent 自行调整），不打扰人；仅 `approvalMode: 'ask-on-risky'` 时危险操作转人工 `waitForApproval`。

### 5.5 codex 显式降级

- `capabilities.interactiveApproval = false`；前端 agent 选择器标注"**无人值守：执行中无法向你提问**"，选择时提示一次
- 不产生 `waiting_input` 态，状态机自然跳过
- **不做 PTY 文本匹配兜底**（脆弱）；codex MCP server 接口成熟后再补一等支持

### 5.6 resume（v1 收敛）

- 服务启动时扫描 `in_progress` / `waiting_input` 的需求 → 统一标 `failed`（error_message："服务重启，执行中断"）→ 人工重试复用 worktree 现场
- 真正的跨进程续跑（Claude `--resume <session_id>`）：**未来增强**

---

## 6. 执行记录与回放（[#57](https://github.com/yiyisf/masterBot/issues/57)）

### 6.1 requirement_runs 表（run 头记录，新表）

```sql
CREATE TABLE requirement_runs (
    id              TEXT PRIMARY KEY,
    requirement_id  TEXT NOT NULL,          -- FK → requirements
    project_id      TEXT NOT NULL,          -- 冗余列，按项目查近期执行
    engine          TEXT NOT NULL,          -- AgentEngineKind
    worktree_path   TEXT,
    branch          TEXT,                   -- req/{req_key}
    session_id      TEXT NOT NULL,          -- 事件流锚点 → session_events
    status          TEXT NOT NULL DEFAULT 'running',
                    -- running / waiting_input / succeeded / failed / cancelled
    retry_no        INTEGER NOT NULL DEFAULT 0,
    pr_url          TEXT,
    error_message   TEXT,
    token_cost      TEXT,                   -- JSON summary
    started_at      TEXT NOT NULL,
    finished_at     TEXT
);
CREATE INDEX idx_req_runs_requirement ON requirement_runs(requirement_id, started_at);
CREATE INDEX idx_req_runs_project     ON requirement_runs(project_id, started_at);
```

不复用 `execution_records`（不往通用表堆专用列）。一次执行一行，重试递增 `retry_no`。

### 6.2 事件流：复用 session_events

- 每次 run 分配独立 `session_id`；engine yield 的每个 `ExecutionStep` 落一条事件（`type` = step 类型，`payload` = step JSON）
- **回放** = `idx_se_session (session_id, timestamp)` 顺序扫 → 前端渲染静态时间线（滚动浏览，无实时节奏动画）
- **人机问答**：`interrupt.raised`（interruptId/question/interruptKind）+ `interrupt.resolved`（answer/approved）事件对；耗时 = 时间差；回放呈现"问了什么、答了什么、等了多久"
- 单事件 payload 沿用 2000 字符截断先例

### 6.3 审计打通：中断双写 audit_approvals

同一中断除落 `session_events` 外写一条 `audit_approvals`（表已有 `execution_id`/`session_id` 字段）。`/audit` 页面零改动可见研发流程人工介入记录。职责分离：`session_events` = 回放原始流水，`audit_approvals` = 审计结构化台账。

### 6.4 数据库可移植性约束（全模块）

当前保持 SQLite（node:sqlite）不变；新表只用标准列型（TEXT/INTEGER）、不用 SQLite 特有功能；数据访问收敛在 repository 层——**未来预留切换远程数据库**时只换实现不动调用方。

---

## 7. mattpocock/skills 集成（[#56](https://github.com/yiyisf/masterBot/issues/56)）

- **复用官方安装命令**（项目级安装），不自建 vendor/clone 逻辑
- **幂等**：仅项目未安装时执行；判据 = 项目目录存在 `skills-lock.json` 且 `.claude/skills/` 软链完好；发起研发前检查，未装则自动安装
- **版本锁定** = 官方 `skills-lock.json`（逐 skill `source/sourceType/skillPath/computedHash`）；为唯一权威，不复制进数据库
- cmasterBot 侧只记 `projects.skills_installed_at` 时间戳
- **wayfinder 默认启用** = bundle 安装即启用（`.claude/skills/` 软链存在即生效），零"启用状态"管理字段
- 升级**人工处理**；自动升级为未来项

---

## 8. 前端 /projects 页面（[#58](https://github.com/yiyisf/masterBot/issues/58)，原型验证胜出：变体 B）

> 原型存档：[`prototype/projects-page-58`](https://github.com/yiyisf/masterBot/tree/prototype/projects-page-58) 分支（三变体对比 + 全交互假数据）。**勿合入**；实现时按生产标准重写。

**页面骨架（状态看板 Kanban）**：

- **顶栏**：项目切换下拉（左）+ 项目目录/来源信息 + 「+ 新建项目」「⟳ 同步需求」（右）
- **主体**：按状态机分列看板——`synced / queued / in_progress / waiting_input / implemented / merged / failed` 各一列，需求卡片随状态流转
- **需求卡片**：`req_key`（等宽）+ 标题 + labels + agent 标记；`waiting_input` 卡片附高亮条「❓ 有问题等你回答」
- **详情交互**：点卡片 → 右侧 Sheet 抽屉（约 480px）：
  - 需求详情 + 操作（发起研发（agent 下拉：claude-code/codex/opencode/pi）、失败重试、`implemented` 态「核验通过，合并 PR」）
  - `waiting_input`：内联问答卡片（textarea + 提交继续执行）
  - 执行过程时间线（静态回放）
- 落选变体 C 的"需要你处理"收件箱概念：**未来增强**候选（如 dashboard 入口卡片）

**新增路由**（`src/gateway/routes/`，命名沿用现有拆分模式）：项目 CRUD、需求同步/手动创建/发起研发/重试/取消/回答中断/核验合并、run 列表与事件流查询。

---

## 9. 范围外（Out of scope）与未来项

**明确排除（本次不做）**：

- 需求清单**定时自动同步**（复用 scheduler）——手动同步跑顺后另立项

**未来增强（地图迷雾留档，不挡实施）**：

- codex/opencode/pi 的子 agent 折叠粒度、resume 调用、审批回调形态——**实现期用真实二进制实测**
- 跨进程真 resume（Claude `--resume` 无缝续跑）
- 需求优先级、依赖顺序、需求间相互影响（如两需求改同一模块的冲突预警）
- mattpocock/skills 自动升级
- PR 自动合并（当前一律人工核验）

---

## 10. 实施建议拆分

按依赖顺序建议 4 个实施阶段（每阶段一个 worktree 分支 + PR）：

1. **数据层**：`projects` / `requirements` / `requirement_runs` 表 + repository（含可移植性约束）+ 项目 CRUD 路由
2. **同步层**：`RequirementSyncSource` 接口 + `SyncSourceRegistry` + GitHub adapter + 手动创建需求
3. **执行层**：`WorktreeManager` + `IAgentEngine` 扩展（capabilities/cwd/approvalMode）+ `ask_user` 注入 + interrupt 双写 + 启动扫描标 failed + codex/opencode/pi 引擎（可再拆）
4. **前端**：`/projects` 看板页 + Sheet 抽屉 + 问答交互 + 回放时间线

---

*本 spec 由 wayfinder 地图 [#52](https://github.com/yiyisf/masterBot/issues/52) 的 7 项决议汇总而成；修改本 spec 的实质性决策请先在对应 ticket 或新 issue 上讨论留痕。*
