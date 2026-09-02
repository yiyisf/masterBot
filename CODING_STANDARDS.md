# CMaster Bot 代码规范

本文是下一代 Workspace（`apps/`、`packages/`、`tooling/`）的强制代码规范。领域词汇、架构边界或 ADR 与本文冲突时，以 `CONTEXT.md`、Architecture 文档和已接受 ADR 为准。冻结的 Legacy 目录遵循 Legacy Freeze，不借“规范化”之名顺手修改。

## 1. 基本原则

- 优先保证正确性、可恢复性、组织隔离和敏感数据安全，再考虑代码简短。
- 设计深 Module：公开 Interface 小而稳定，复杂性隐藏在拥有该行为的 Module 内。
- 当前 Slice 先按已接受的数据模型、Module Interface 和 ADR 实现最小端到端闭环；不为尚未规划的业务规则、管理能力或假设性极端组合增加设计。
- 选择满足当前验收且容易演进的最简单实现。规范明确要求的安全、授权、幂等、并发和恢复路径属于首版正确性，不得以“避免过度设计”为由省略。
- 不为未进入当前 Slice 的需求创建空 Package、Port、状态、配置表或策略语言；仅为已有架构要求保留稳定 Seam。
- 能力必须在 Architecture/Data Model 指定的所属 Module 实现。当前 Slice 的闭环需要时，在该 Module 内增量补齐，不等待或臆造按能力命名的独立 Slice。
- Slice 是交付边界而非领域所有权边界；允许一个 Slice 修改多个 Module，但禁止把行为临时塞入调用方、Composition Root 或其他 Module。
- 同一领域概念使用 `CONTEXT.md` 中的唯一名称；不得用近义词制造第二套模型。
- 文件长度只是检查信号，不是拆分规则。只有出现多个变化原因、重复逻辑或不清晰所有权时才拆分。

## 2. Workspace 与 Module 边界

- Workspace Package 使用 `@cmaster/*` 根导入；禁止跨 Package 深导入和相对路径穿越。
- Domain/Public Contract 不得暴露 Provider SDK、AI SDK、OpenTelemetry、数据库或 Transport 类型。
- 数据表、Migration、Repository/Adapter 由所属 Module 独占。跨 Module 协作通过公开 Interface，不直接 JOIN 或查询其他 Module 的表。
- `apps/*` 是 Composition Root 和 Transport/UI Adapter；业务不变量不得只存在于 Route、React Component 或启动脚本中。
- `index.ts` 仅导出该 Package 的公开 Interface；内部辅助函数默认不导出。

## 3. 源码与测试目录

采用“Unit Test 共置、Integration Test 分离”的规则：

```text
packages/<module>/src/foo.ts
packages/<module>/src/foo.test.ts              # Unit/Contract Test，可共置
apps/<app>/src/foo.ts
apps/<app>/src/foo.test.ts                      # App Unit Test，可共置
apps/<app>/test/foo.integration.test.ts         # PostgreSQL/HTTP/多 Module Integration Test
```

- `src/` 中只能共置快速、确定性、无外部基础设施的 Unit/Contract Test。
- 需要 PostgreSQL、真实 HTTP Server、多 Module Composition 或进程恢复语义的测试放入 `test/`。
- `*.test.ts(x)` 和 `*.integration.test.ts` 不得进入生产 `dist`、Package exports 或发布文件。
- 测试代码必须通过独立 TypeScript 检查，不能只依赖 Vitest 的转译。
- 测试优先调用公开 Interface；只有 Migration、Schema ownership 等边界测试可以直接检查持久化结构。
- Fake 实现放在测试代码中并保持确定性；普通 CI 不调用付费 Provider。

## 4. TypeScript 与命名

- 开启并保持 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和 `useUnknownInCatchVariables`。
- Domain ID 使用 Brand 或明确领域类型；不要用无语义的 `string` 在公开 Interface 中代替 ID。
- 类型和类使用 `PascalCase`，函数/变量使用 `camelCase`，常量使用能表达语义的名称；避免 `data`、`info`、`manager` 等模糊命名。
- 优先使用 discriminated union 表达状态和事件；不得用互相冲突的多个 boolean 模拟状态机。
- 外部输入在边界处用 Zod/协议 Schema 校验；内部代码不重复散落相同校验。
- 避免 `any`、无依据的类型断言和非空断言。若控制流已经证明非空，优先通过显式分支让 TypeScript 完成收窄；仅当第三方/SQL 返回类型无法表达紧邻的不变量时允许局部断言。
- 捕获值保持 `unknown`；跨 Module 失败使用稳定、安全、可判别的错误或失败类型。

## 5. 函数、控制流与可读性

- 一个函数应表达一个完整意图；事务、Lease fencing、事件追加等必须保持原子语义，不为缩短函数而拆散不变量。
- 使用 guard clause 减少嵌套；复杂条件提取为能说明业务含义的函数或变量。
- 同一 union 上的重复 `switch` 若表达不同 Adapter 映射可以保留；若重复同一业务决策，应集中到拥有该决策的 Module。
- 参数经常成组出现时定义类型；不要让多个 ID、sequence、generation 以无名 primitive 长期同行。
- 不吞掉异常。若故意忽略 heartbeat、logging、notification 等辅助失败，必须注释说明为何不改变主流程语义。
- 禁止提交注释掉的代码、临时调试输出或未受控的 `console.log`。

## 6. 注释与 JSDoc

- 注释解释“为什么、约束、不变量和风险”，不要逐句翻译代码做了什么。
- 公开 Interface 和不直观的并发/恢复逻辑使用 JSDoc，至少说明：所有权、顺序/幂等不变量、失败语义及重要性能特征。
- 项目内解释性注释优先使用中文；协议名、类型名、事件名和代码标识保持英文原名。
- 临时实现必须说明：为什么临时、由哪个后续 Module/Slice 替换、替换前哪些边界不能突破。
- `TODO/FIXME` 必须关联 Issue、ADR 或明确后续 Slice；无法追踪的 TODO 不得合并。
- 注释不得包含 Prompt、生成内容、API Key、Credential、员工数据或 Provider 原始错误示例。
- 代码变化使注释失真时，注释与代码必须在同一提交更新。

## 7. 持久化、事件与并发

- PostgreSQL 定义生产语义；所有 SQL 参数化，所有 Organization 数据查询显式包含 `organizationId`。
- 状态表、Run Event、Outbox/Dispatch 的更新按 ADR 要求在同一事务提交。
- Run Event 按 `(runId, sequence)` 严格排序；消费者必须容忍 at-least-once 传输并按 sequence 去重。
- Lease/attempt/generation 等 fencing token 必须在写入前校验；旧 Worker 不得覆盖恢复 Worker 的结果。
- Provider/Tool 外部调用前先持久化审计或恢复记录；禁止隐藏重试。
- Migration 只前进、不依赖手工步骤，并在目标 PostgreSQL 主版本 CI 中从空库验证。

## 8. 安全与可观测性

- Browser Contract、Run Event、数据库审计和 Trace 只包含批准的安全字段。
- Prompt、生成内容、API Key、Credential 明文和 Provider 原始错误不得进入 ModelCall、Trace 或普通日志；确需内容持久化时只能进入其权威业务模型。
- 日志使用结构化安全上下文；不得直接记录未知异常对象，因为异常可能携带请求体或 Provider 响应。
- OpenTelemetry/日志导出失败不得改变业务结果。
- 对外错误使用安全、稳定的 code/message；内部堆栈不进入 HTTP/SSE/UI。

## 9. Contract、UI 与生成物

- 外部 HTTP/SSE/UI 接口 Contract-first；Zod 是运行时边界，OpenAPI 与 Client 类型由脚本生成。
- canonical Run Event 与 UI Stream 分离；Presenter 只能投影，不能执行模型或写业务状态。
- Reducer/Projection 按 sequence 应用事件，并对未知事件提供安全降级。
- 生成文件必须由标准命令生成并提交；禁止手改 OpenAPI 或 generated types。
- React 页面保持展示/交互职责，Server 状态与协议映射放入可测试的 Adapter/Projection。

## 10. 依赖与质量门禁

- 新依赖使用精确版本并说明引入理由；升级遵循 ADR-0035，不运行自动破坏性升级。
- 合并前至少通过：Contract drift、Module boundaries、Lint、源码与测试 TypeScript 检查、Build、Unit/Contract Test。
- 涉及 PostgreSQL、Lease、SSE 或多 Module 语义时必须运行 Integration Test。
- 涉及 Provider Adapter 时必须有确定性 Fake/本地协议测试；真实付费 Smoke 必须显式启用且默认跳过。
- 已知 Legacy 失败需在 PR 中如实记录；不得通过修改冻结目录掩盖。
