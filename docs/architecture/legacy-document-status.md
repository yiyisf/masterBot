# 历史设计资料状态

旧的架构评审、Phase 路线图、能力差距报告、Harness patch、研发流程旧规格和 v3/v3.1 重构方案已从当前工作树移除，避免未来实现误把它们当成规范。

Git 历史仍可用于追溯现有原型代码的形成原因，但历史资料不能用于：

- 决定新领域术语或数据模型
- 要求兼容旧 `ExecutionStep`、Session、API 或 SQLite 数据
- 恢复长期 `refactor/v3` 分支和最终一次性合并策略
- 推翻 Web-first、服务端执行、PostgreSQL、API/Worker 或模块化单体决策
- 绕过本目录定义的 Module Interface 和 Adapter Seam

当前规范来源按优先级为：

1. 根目录 [`CONTEXT.md`](../../CONTEXT.md)
2. [`docs/adr/`](../adr/) 中未被取代的 Accepted 决策
3. [`docs/architecture/`](./README.md) 本目录
4. 对应 Slice 的已评审 Contract、测试和 Eval Evidence

仍保留的 `docs/getting-started.md`、`docs/skills-guide.md` 与根 `README.md` 描述当前可运行原型；它们不是下一代目标架构规范。随着对应 Vertical Slice 替换旧实现，应同步重写或删除相关原型说明。
