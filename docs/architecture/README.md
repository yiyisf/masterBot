# CMaster Bot 下一代架构基线

> **状态：Accepted / Normative**

本目录是 CMaster Bot 后续重构的规范性设计基线。若旧 README、评审、路线图或实施提示词与本目录冲突，以本目录、根目录 [`CONTEXT.md`](../../CONTEXT.md) 和 [`docs/adr/`](../adr/) 中已接受的决策为准。

## 文档导航

- [目标架构](./target-architecture.md) — 产品边界、分层、运行拓扑和关键数据流
- [Module 接口清单](./module-interfaces.md) — Module 所有权、公开 Interface 和 Adapter Seam
- [领域数据模型](./data-model.md) — 聚合、关系、持久化映射和不变量
- [增量重构计划](./refactor-plan.md) — 分支、Slice、验收、退出条件与后续路线
- [旧文档状态](./legacy-document-status.md) — 历史资料的非规范性说明
- [领域语言](../../CONTEXT.md) — 项目统一术语
- [架构决策](../adr/) — 关键取舍及原因
- [Slice 3 Governed Tool Runtime 设计](../design/slice-3-governed-tool-runtime.html) — Grill 对齐后的自包含实施设计

## 架构图

| 图 | SVG | 可编辑 Mermaid 源文件 |
|---|---|---|
| 整体目标架构 | [overall-architecture.svg](./diagrams/overall-architecture.svg) | [overall-architecture.mmd](./diagrams/overall-architecture.mmd) |
| 分层架构 | [layer-architecture.svg](./diagrams/layer-architecture.svg) | [layer-architecture.mmd](./diagrams/layer-architecture.mmd) |
| API/Worker 异步流程 | [runtime-flow.svg](./diagrams/runtime-flow.svg) | [runtime-flow.mmd](./diagrams/runtime-flow.mmd) |
| 领域数据模型 | [data-model.svg](./diagrams/data-model.svg) | [data-model.mmd](./diagrams/data-model.mmd) |

## 阅读顺序

1. 新成员先读 `CONTEXT.md`，避免继续混用 Session、Skill、Tool、Run 等术语。
2. 开始一个 Slice 前读目标架构和对应 Module Interface。
3. 遇到技术取舍时查 ADR；不要从历史规划文档推断当前方向。
4. 实施必须遵循 [`docs/engineering/refactor-branching.md`](../engineering/refactor-branching.md)，禁止直接修改 `master`。

## 变更规则

- 领域语言改变：先更新 `CONTEXT.md`。
- 难以逆转、存在真实权衡且不解释会令人困惑的决定：新增 ADR。
- 外部 Contract 改变：按版本兼容规则更新 `packages/contracts` 设计和文档。
- 只影响 Adapter 的技术替换：通常不修改领域模型，也不新增领域术语。
- 本目录不以“保持旧原型兼容”为目标；旧 SQLite 数据与旧 API 可丢弃。
