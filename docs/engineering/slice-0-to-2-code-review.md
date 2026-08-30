# Slice 0–2 代码规范与可读性审查

## 审查范围

- 固定点：`f57ad00fc0da0aac8c0515b84eeb6365a9274ca5`（Slice 0 之前）
- 当前点：Slice 2 提交 `00e384a`
- Diff：`git diff f57ad00...HEAD`
- 提交：Workspace Foundation、Run Walking Skeleton、AI SDK Runtime
- Spec：`docs/architecture/refactor-plan.md` 的 Slice 0–2，以及关联 ADR/Module Interface
- Standards：`AGENTS.md`、`CLAUDE.md`、Architecture/Engineering 文档和 Fowler smell baseline

本次审查分开检查 Standards 与 Spec，避免“实现正确但不规范”或“代码整洁但实现错需求”互相掩盖。

## Standards

### S1 — 测试进入生产构建产物（已修复，High）

`packages/*/tsconfig.json` 通过 `src/**/*.ts` 包含共置的 `*.test.ts`，因此干净构建前的检查发现 `packages/models/dist/openai-compatible.test.js` 等测试产物。测试不应进入 Package `dist` 或 exports。

修复：

- 在 `tsconfig.next.base.json` 排除 Unit/Integration Test；
- 从空 `dist` 重建并验证没有 test/spec JavaScript 或 declaration；
- 在 `CODING_STANDARDS.md` 固化“测试不得进入生产构建”。

### S2 — Integration Test 与生产源码混放（已修复，Medium）

三个需要 PostgreSQL/HTTP/多 Module 的测试位于 `apps/server/src/*.integration.test.ts`，使 `src` 同时承担生产源码和基础设施测试职责，浏览代码时噪声较大。

修复：移动到 `apps/server/test/*.integration.test.ts`，并更新 Vitest 配置。Unit/Contract Test 仍允许与被测源码共置，这是有意的可发现性选择，不要求机械拆成第二棵目录树。

### S3 — 测试没有完整 TypeScript 检查（已修复，High）

Vitest 的转译不会报告所有类型错误。独立运行 `tsc -p tsconfig.next.lint.json` 后发现 Recovery Test 访问不存在的 `RunLease.employeeText`；运行时 Fake Adapter 未读取该值，所以测试此前仍会通过。

修复：

- 修正无效属性访问；
- 新增 `npm run next:typecheck:tests`；
- 使用与 Vitest 一致的 `development` Package export condition，保证无 `dist` 的干净环境也能解析 Workspace 源码；
- 将其加入 `npm run next:check`。

### S4 — 大文件与深 Module（无违规，Judgement）

`packages/execution/src/postgres.ts`、`packages/models/src/postgres.ts` 和 Integration fixture 较长，但主要复杂度来自事务、Lease fencing、ModelCall/Fallback 顺序不变量。当前公开 Interface 仍小，拆开事务步骤反而会泄漏复杂性，因此不按“文件行数”机械拆分。若后续出现多个变化原因或重复 SQL 决策，再提取 Module 内部文件。

### S5 — 注释质量（无未解决问题）

Slice 2 的临时逻辑已经说明替换目标，例如 Agent Admin、Context Builder、Credential Broker、Policy 和正式 Workspace Presenter。注释主要解释约束和原因，没有记录 Prompt、Secret 或 Provider 原始异常。新规范进一步明确中文解释性注释、Public Interface JSDoc 和可追踪 TODO 的要求。

## Spec

### Slice 0 — Workspace Foundation

已实现 Workspace、Project References、Contract 生成、边界检查、PostgreSQL CI、Feature Flag 和 Server/Web 可运行基础。未发现缺失或额外恢复 Legacy 依赖的情况。

### Slice 1 — Run Walking Skeleton

已实现 Browser → API → PostgreSQL → Worker → SSE、Development Identity、Echo Revision、Outbox/Lease、取消边界、恢复和最小 Workspace。测试覆盖幂等、组织隔离、Lease、SSE replay 和 `output_ready` 竞争。未发现未解决偏差。

### Slice 2 — AI SDK Runtime

已实现 Models Module、OpenAI-compatible Adapter、AI SDK Engine、ModelCall/usage/OTel、受控 Fallback、持久 output generation、失败/恢复 reset、UI Stream Presenter 和 Fake/Smoke Eval。AI SDK/Provider/OTel 类型终止于 Adapter，Browser 只获得安全模型字段。未发现未解决偏差或超出当前 Slice 的 Tool/Context/Admin 实现。

## 结论

- Standards：发现 3 个实质问题，均已修复；2 个判断项无违规。
- Spec：0 个未解决问题。
- 最严重 Standards 问题：测试代码缺少 TypeScript 门禁并进入生产构建。
- Spec 无最严重问题：Slice 0–2 的验收范围均已覆盖。
