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

## Phase 5：Session 高级特性（1 周）✅

**分支**：`v3-p5-session` | **PR**：#37 | **合并**：2026-05-13  
**目标**：实现 session fork / resume / checkpoint（数据库 + API + Web UI）。  
**关键产出**：fork/checkpoint/resume 完整链路；sessions.parent_session_id 自动迁移；ForkButton + CheckpointPanel；18 个新测试。

---

## Phase 6：Memory 四层 + 租户隔离（2 周）✅

**分支**：`v3-p6-memory` | **PR**：#38 | **合并**：2026-05-15  
**目标**：Working / Episodic / Semantic / Procedural 四层记忆架构，SQLite FTS5，tenant 强制隔离。  
**关键产出**：IMemoryRouter 接口；L2 EpisodicMemoryStore（FTS5+TTL）；L3 SemanticMemoryStore（HitL 门）；L4 ProceduralMemory（fs.watch 热重载）；12 个新测试。  
> 注：计划 PostgreSQL+pgvector，实际用 SQLite FTS5，避免新基础设施依赖。

---

## Phase 6.5：DuckDB VSS + HitL 强化（增补 Phase）✅

**分支**：`v3-p6.5-memory-supplement` | **PR**：#40 | **合并**：2026-05-15  
**目标**：修复 Phase 6 review 问题，zod v4 全量升级，HitL 前端，Active Compression。  
**关键产出**：zod v4 升级；Active Compression；tenantId 透传修复；9 个新测试。  
> 注：PR #39 错误合入 master，已 revert 后通过 PR #40 正确合入 refactor/v3。

---

## Phase 7：企业 IM 一等公民（1 周）✅

**分支**：`v3-p7-enterprise-im` | **PR**：#41 | **合并**：2026-05-15  
**目标**：统一 `IChannel` 抽象，飞书/钉钉/WeCom/Teams 全渠道 HitL 标准化。  
**关键产出**：IChannel 接口；FeishuChannel（AES 加密+缓存+三态）；DingTalkChannel（新增）；HitlCardRenderer；ChannelRouter；安全加固（timingSafeEqual）；24 个新测试。

---

## Phase 8：Admin Console 基础（1 周）✅

**分支**：`v3-p8-admin-console` | **PR**：#42 | **合并**：2026-05-16  
**目标**：IT/安全/财务团队专用管理后台，独立 X-Admin-Key 鉴权。  
**关键产出**：AdminRepository；9 个 admin API 端点（全 403 保护）；5 个前端管理页面（概览/技能审批/RBAC/审计/成本）；web/src/lib/admin.ts 共享工具；17 个新测试。

---

## Phase 9：评估金字塔（持续 Phase）✅

**分支**：`worktree-refactor-v3-p9` | **PR**：#43 | **合并**：2026-05-16  
**目标**：三层评估金字塔：Tier 1 Offline Eval + Tier 2 Shadow Traffic + Tier 3 Canary 发布。  
**关键产出**：4 套 capability YAML（各 30 条）+ Golden Set（50 条）；ShadowTrafficService；CanaryService（渐进发布 5%→100%+自动回滚）；GitHub Actions eval CI；201 个新测试。  
**ADR**：ADR-0013（评估金字塔三层架构）；同期补充 ADR-0005 ~ ADR-0012（P1-P8 回溯记录）  
> 注：Phase 9 是「持续 Phase」，与后续所有 Phase 并行；每个 Phase 完成后需补充用例并检查 shadow traffic。

---

## Phase 9.5：Skill Factory 2.0 ✅

**分支**：`worktree-refactor-v3-p9.5` | **PR**：#44 | **合并**：2026-05-16  
**目标**：员工自助创建技能的完整流程（生成 → 沙箱测试 → 安全审核 → 发布同步）。  
**关键产出**：五阶段流水线（UNDERSTAND/SYNTHESIZE/VERIFY/EVAL/PUBLISH）；双段协同（LocalSkillFactory + EnterpriseSkillFactory）；8 状态生命周期；16 条安全规则；LLM-as-Judge 4 维度评分；Auto-Curator；5 步向导 UI；41 个新测试。  
**ADR**：ADR-0014（Skill Factory 五阶段流水线）

---

## Phase 9.7：UI/UX Design System ✅

**分支**：`worktree-refactor-v3-p9.7` | **PR**：#45 | **合并**：2026-05-17  
**目标**：建立设计系统（Design Tokens + 三主题 + 26 组件 + Storybook），为 Web MVP 提供统一基础。  
**关键产出**：6 个 Token 文件（color/typography/spacing/radius/shadow/motion）；三主题（light/dark/high-contrast WCAG AAA）；26 个组件（基础 UI 3 + 业务 10 + 布局 5 + 升级 8）；Storybook 8.6.18（7 stories 文件，28+ stories，addon-a11y）。  
**ADR**：ADR-0015（UI/UX 设计系统 — Design Tokens + 三主题 + Storybook）

---

## Phase 10：Web 版 MVP（2 周）🔄

**分支**：`worktree-refactor-v3-p10` | **PR**：#46（开放中）  
**目标**：Web-First 上线，企业员工可通过浏览器访问完整功能。这是第一个对外可用的里程碑。  
**关键产出**：IStorageAdapter 抽象（Phase 13 Electron 预留）；AG-UI Runtime；Login 页 + History 页；⌘K 命令面板；首次引导；Error Boundary；Service Worker 离线；Settings 个人偏好 Tab；Skills 目录 Tab；HTTPS 代理 TLS 修复。  
**ADR**：ADR-0016（IStorageAdapter 抽象）；ADR-0017（HTTPS 代理函数包装）

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
