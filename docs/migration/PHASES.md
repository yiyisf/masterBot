# masterBot v3 重构 — Phase 总览

总周期约 24 周，共 16 个 Phase。所有 Phase 在 `refactor-v3` 分支上汇集，最终一次性合入 `master`。

---

## Phase 0：准备工作（1 周）

**分支**：`refactor-v3-p0-preparation`  
**目标**：建立 ADR 体系、docs/migration 目录、安装 Claude Agent SDK、跑通 smoke test。  
**关键约束**：不修改任何现有 `src/` 代码。  
**完成标准**：4 份 ADR、SDK v0.2.138 安装、smoke test 可运行。

---

## Phase 1：可观测性先行（1 周）

**分支**：`refactor-v3-p1-observability`  
**目标**：引入 OpenTelemetry SDK，替换 SpanRecorder，部署 Langfuse self-hosted。  
**关键产出**：所有现有功能在 Langfuse 上有完整 trace。

---

## Phase 2：Hooks 重构（2 周）

**分支**：`refactor-v3-p2-hooks`  
**目标**：引入 `IAgent` 接口，把 sandbox/IM 审批/memory injection 重构为标准 Hook。  
**关键产出**：测试通过率保持 100%，内部架构对齐 SDK 协议。

---

## Phase 2.5：Identity & Policy Foundation

**分支**：`refactor-v3-p2.5-identity`  
**目标**：企业 SSO/SCIM 集成基础、5 层权限引擎（PermissionEngine）、租户隔离基础。

---

## Phase 3：ClaudeManagedAgent 上线（2 周）

**分支**：`refactor-v3-p3-claude-managed`  
**目标**：实现 `ClaudeManagedAgent`（包装 SDK query()），在 Settings 页面增加开关，灰度切换。  
**关键产出**：Anthropic provider 默认走 SDK，capability eval 可对比 Legacy vs Managed。

---

## Phase 4：Skills + Subagents 升级（2 周）

**分支**：`refactor-v3-p4-skills-subagents`  
**目标**：把 `skills/built-in/` 重组成 Anthropic Skills 格式（Progressive Disclosure），实现核心 Subagents。  
**关键产出**：主 agent 平均 input tokens 减少 ≥30%。

---

## Phase 5：Session 高级特性（1 周）

**分支**：`refactor-v3-p5-session`  
**目标**：实现 session fork / resume / checkpoint（数据库 + API + Web UI）。

---

## Phase 6：Memory 四层 + 租户隔离（2 周）

**分支**：`refactor-v3-p6-memory`  
**目标**：Working / Episodic / Semantic / Procedural 四层记忆架构，引入 PostgreSQL + pgvector。

---

## Phase 7：企业 IM 一等公民（1 周）

**分支**：`refactor-v3-p7-im`  
**目标**：统一 `IChannel` 抽象，飞书/钉钉/Telegram/iMessage 全渠道 HitL 标准化。

---

## Phase 8：Admin Console 基础（1 周）

**分支**：`refactor-v3-p8-admin`  
**目标**：企业管理后台：用户管理、权限配置、技能审核、审计报告。

---

## Phase 9：评估金字塔（2 周）

**分支**：`refactor-v3-p9-evals`  
**目标**：引入 promptfoo，建立 capability eval 套件，GitHub Actions 自动运行。

---

## Phase 9.5：Skill Factory 2.0

**分支**：`refactor-v3-p9.5-skill-factory`  
**目标**：员工自助创建技能的完整流程（生成 → 沙箱测试 → 安全审核 → 发布同步）。

---

## Phase 9.7：UI/UX Design System

**分支**：`refactor-v3-p9.7-design-system`  
**目标**：建立设计系统（shadcn/ui 扩展 + Tailwind tokens），重设计核心页面。

---

## Phase 10：Web 版 MVP（2 周）

**分支**：`refactor-v3-p10-web-mvp`  
**目标**：Web-First 上线，企业员工可通过浏览器访问完整功能。这是第一个对外可用的里程碑。

---

## Phase 11：Web 版灰度上线（1 周）

**分支**：`refactor-v3-p11-web-rollout`  
**目标**：灰度发布策略、用户反馈收集、性能监控、回滚预案。

---

## Phase 12：Web 版迭代运营（持续）

**目标**：基于 Langfuse 数据和用户反馈持续优化，能力 eval 通过率逐步提升。

---

## Phase 13：Electron 准备 + 适配（1 周）

**分支**：`refactor-v3-p13-electron-prep`  
**目标**：评估 Electron vs Tauri，代码分层适配（Electron-specific 能力隔离）。

---

## Phase 14：Electron 打包（macOS + Windows）（2 周）

**分支**：`refactor-v3-p14-electron`  
**目标**：跨平台桌面应用打包、代码签名、自动升级机制（三轨升级体系）。

---

## Phase 15：三轨升级体系（1 周）

**分支**：`refactor-v3-p15-upgrade`  
**目标**：内核升级 / 技能同步 / 配置热更新，全量回滚机制。

---

## Phase 16：Electron 灰度上线

**目标**：桌面应用灰度发布，企业 IT 批量部署支持（MSI/PKG 格式）。
