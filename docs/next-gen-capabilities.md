# CMaster Bot — 下一代企业 AI 能力规划报告（v2）

> **背景**：CMaster Bot 已完成 Phase 1–13，具备 ReAct Agent、自动技能生成、知识图谱、多 Agent 协作、定时调度、可视化工作流等核心能力。本报告面向**公司内网员工**（存在外网访问限制），依托**公司内部 AI 大模型**，规划下一阶段的突破性服务场景。
>
> **关键约束**：① 无 GitLab/Jira/Confluence 等开源标准工具，使用公司自有同类系统；② 通知渠道为公司内部系统；③ **所有场景须具备强工具扩展性**，外部系统接入应零侵入、可插拔；④ **员工终端以 Windows 为主，兼顾 macOS**，所有客户端能力须跨平台兼容。

---

## 设计纲领：能力适配层（Capability Adapter Layer）

所有场景均基于**抽象能力接口 + SKILL.md 协议 + ConnectorManager**实现工具解耦：

```
业务场景
   ↓ 调用抽象能力接口
能力适配层（Capability Adapters）
   ├─ ICodeRepository    →  代码管理适配器（SKILL.md）
   ├─ IProjectTracker    →  项目管理适配器（SKILL.md）
   ├─ IKnowledgeBase     →  知识库适配器（SKILL.md）
   ├─ INotificationHub   →  通知适配器（SKILL.md）
   └─ IDataWarehouse     →  数据仓库适配器（SKILL.md）
         ↓ 具体实现
   ConnectorManager（YAML 连接器配置）
   HTTP Client / Shell / DB Driver / RPA
```

**接入新工具只需：** 编写一个 `SKILL.md` + `index.ts` 适配器，声明对应接口的动作实现。现有 Agent 无需任何改动即可调用新工具。

---

## 当前能力缺口分析

| 维度 | 当前状态 | 缺口 |
|------|----------|------|
| **知识覆盖** | 手动导入文档到知识图谱 | 无法自动同步内部系统实时变化 |
| **研发辅助** | Shell + HTTP + 文件操作 | 缺代码理解深度；无内部研发工具链全链路感知 |
| **个性化** | 无用户区分，共享上下文 | 无员工身份、偏好、历史行为建模 |
| **数据洞察** | 无 | 无法对接内部数据仓库，不支持自然语言分析业务数据 |
| **运维智能** | 无 | 无法接收告警、分析日志、自动执行故障响应 |
| **GUI 操作** | 无 | 无法操作内部 Web 系统（ERP/OA 等无 API 的遗留系统） |
| **团队协作** | 无多用户概念 | 无跨人员任务分发、协作记录、知识归因 |

---

## 场景一：全链路研发智能体（Dev Intelligence Hub）

### 痛点
研发人员每天需在代码库、项目管理、知识库、CI 之间频繁切换。代码审查依赖人力，文档长期滞后，Bug 分析靠经验积累——高价值但高重复的认知劳动。

### 能力设计

```
用户："帮我审查一下最新提交的变更，重点关注安全和性能"
         ↓
[Agent 编排]
  ├─ code-repo.get_diff(branch)            → 获取代码变更（适配任意代码仓）
  ├─ knowledge_search("认证模块安全规范")   → 从知识图谱获取公司安全标准
  ├─ shell.execute("semgrep --config=...")  → SAST 静态安全扫描（本地工具）
  ├─ project-tracker.get_linked_items(id)  → 关联需求上下文（适配任意项目管理）
  └─ LLM 综合分析 → 生成结构化 Review 报告
         ↓
  code-repo.post_comment(report)           → 回写评论到代码仓
  notification-hub.send(author, summary)   → 通知作者（适配内部通知系统）
```

**核心子能力：**
- **代码影响分析**：变更影响哪些下游服务/测试用例（基于 AST + 调用图）
- **测试用例生成**：根据函数签名 + 业务文档自动生成单测、接口测试
- **技术债务扫描**：识别 TODO/FIXME/反模式并创建项目跟踪任务
- **文档同步**：代码变更后自动更新知识库对应模块的技术文档

**工具扩展点（SKILL.md 适配器接口）：**
```yaml
# skills/adapters/code-repo/SKILL.md
name: code-repo
interface: ICodeRepository
actions:
  - get_diff       # 获取代码变更差异
  - post_comment   # 发布 Review 评论
  - get_ci_status  # 获取 CI/CD 流水线状态
  - list_branches  # 列举分支
```

**业务价值：**
- Code Review 时间 -60%
- 文档覆盖率：30% → 80%
- 缺陷逃逸率 -40%

---

## 场景二：企业大脑——活知识体系（Living Knowledge Fabric）

### 痛点
企业知识分散在各类内部系统、Wiki、聊天记录、代码注释中，随时间快速过时。员工经常"找不到"或"不知道谁知道"，新人 Onboarding 成本极高。

### 能力设计

**自动知识摄入管道：**
```
[定时调度 Cron + Webhook 双触发]
  ├─ 每小时：通过 code-repo 接口扫描 commit message → 提取技术决策
  ├─ 每天：通过 knowledge-base 接口同步更新的 Wiki/文档页面
  ├─ 实时：内部系统 Webhook → 新评论/决策 → 触发 Agent 摄入
  └─ LLM：实体抽取 + 关系识别 → 增量写入知识图谱
```

**多跳推理问答示例：**
```
问："支付服务的数据库主库宕机会影响哪些业务，谁是 oncall？"
答：支付服务(owner:@张三) → 依赖 MySQL-PaymentDB → 下游影响：订单服务、退款服务
    → 本周 oncall: @李四 → 历史参考：INC-2024-08-15（处置 47 分钟）
```

**知识图谱新增能力：**
- `incrementalIngest(source, delta)` — 增量更新，不全量重建
- `findExperts(topic)` — 基于贡献历史的专家推荐
- `detectConflicts()` — 两文档对同一实体矛盾时自动预警

**业务价值：**
- 新员工 Onboarding 时间 -50%
- 重复提问减少 70%
- 事故定位速度 +3x

---

## 场景三：AIOps 智能运维中枢（Intelligent Operations Hub）

### 痛点
告警风暴（每天数百条）→ 工程师告警疲劳 → 真正的 P0 被淹没。根因分析依赖资深工程师经验，新人无法独立处理。

### 能力设计

**告警分诊与自动响应（Webhook 入站 + Agent 编排）：**
```
内部监控系统 → POST /api/webhooks/:id/trigger（HMAC 签名验证）
  → Agent 自动执行 Runbook
        ├─ 1. 告警分级（P0/P1/P2）+ 置信度评分
        ├─ 2. knowledge_search：查询该服务历史故障模式
        ├─ 3. shell.execute：排查命令（容器状态、DB 健康、日志分析）
        ├─ 4. 置信度 > 80%：自动修复（重启服务、切流量）
        └─ 5. notification-hub.send：推送根因分析报告
```

**Runbook 即代码（YAML 声明式）：**
```yaml
# runbooks/service-oom.yaml
trigger:
  type: webhook
  condition: "alert.name contains 'OOM'"
steps:
  - tool: shell.execute
    command: "kubectl top pods -n {{ service.namespace }}"
  - tool: llm.analyze
    prompt: "判断是内存泄漏还是流量突增，依据：{{ previous_output }}"
  - condition: "analysis.is_memory_leak == true"
    tool: shell.execute
    command: "kubectl rollout restart deployment/{{ service.name }}"
```

**业务价值：**
- MTTR（平均修复时间）-70%
- 告警噪声 -60%
- 7×24 无人值守运维覆盖

---

## 场景四：员工数字分身（Personal AI Companion）

### 痛点
每位员工每天面临信息过载：待处理任务、会议纪要待整理、文件待审签。

### 能力设计

**个性化工作日报（每天 8:55 自动推送）：**
```
为每位员工生成专属工作日报:
  ├─ 昨日进展：@我 相关的任务更新 + 代码评审评论
  ├─ 今日重点：日历会议安排 + 截止任务 Top3
  ├─ 阻塞预警："你的任务 #234 已被 #189 阻塞，建议今日跟进 @李四"
  └─ 知识推送：根据你的项目，推荐 1 篇相关内部文档
```

**会议智能体：**
```
会议结束后上传录音/文字记录:
  ├─ LLM 提取：决策项、行动项、遗留问题
  ├─ project-tracker.create_items(action_items)
  ├─ knowledge-base.write_page(minutes)
  └─ notification-hub.send(group, summary)
```

**业务价值：**
- 每员工每天节省 1.5 小时
- 100 人团队 = 每天节省 150 人时 ≈ 19 人·天

---

## 场景五：自然语言数据分析平台（NL2Insight）

### 痛点
业务数据在内部数据仓库中，只有数据分析师懂 SQL。产品/运营/管理层看数据需等待 2-3 天。

### 能力设计

**自然语言 → SQL → 可视化 → 洞察（全链路）：**
```
用户："上个月哪个城市的订单转化率最低？分析原因"
  1. data-warehouse.get_schema("orders")   → 获取表结构上下文
  2. LLM：NL2SQL 生成查询语句（Schema-Aware Prompting）
  3. data-warehouse.execute_query(sql)     → 执行查询（只读权限）
  4. LLM：生成 ECharts 图表配置（内嵌于聊天消息渲染）
  5. 洞察输出："成都转化率 12.3%（最低），推测原因：配送时效差"
```

**数据安全沙箱：**
```typescript
const SAFETY_RULES = {
    allowedTypes: ['SELECT'],           // 拒绝 INSERT/UPDATE/DELETE/DROP
    maxRows: 10_000,                    // 行数上限
    sensitiveFields: ['phone', 'id_card', 'salary'],  // 自动 mask
    auditLog: true                      // 查询血缘记录
};
```

**业务价值：**
- 数据需求响应：3 天 → 3 分钟
- 全员数据驱动决策覆盖率 100%

---

## 场景六：遗留系统 AI-RPA 融合（Legacy System Automation）

### 痛点
大量内部系统（ERP/OA/财务）无 API，只能靠人工操作 Web 界面。

### 能力设计

**视觉理解 + 自动操作：**
```
用户："帮我在 OA 系统提交 5 月份的报销单"
  1. browser.screenshot()                      → 截图当前界面
  2. vision.locate_element("新建报销单按钮")   → 识别按钮坐标
  3. browser.click(coord) + browser.fill_form(fields)
  4. browser.screenshot()                      → 预览截图给用户确认
  ⚠️ 等待用户确认 → 提交 + 截图存档
```

**新增技能（browser-automation）：**
- screenshot, click, type, upload_file, extract_table
- Windows 优先驱动 Edge（内置）；macOS 优先驱动 Chrome

**业务价值：**
- 行政/财务/人事重复操作自动化率 70%
- 录入错误率：人工 5% → 自动化 <0.1%

---

## 场景七：智能项目管理与决策支持

### 痛点
项目延期预警依赖 PM 经验，风险识别滞后。

### 能力设计

**项目健康度实时评分（每日自动计算）：**
```
健康分 = f(进度指数, 质量指数, 团队指数, 风险指数)
预警："Project X 有 73% 概率延期 2 周"
建议："建议将任务 #456 拆分为更小粒度 + 提前启动 API 联调"
```

**业务价值：**
- 项目交付准时率 +25%

---

## 操作系统兼容性设计（Windows 主 / macOS 辅）

| 能力模块 | Windows 兼容要点 | 解决方案 |
|---------|----------------|---------|
| **Shell 技能** | Windows 默认 cmd/PowerShell，无 bash | 检测 `process.platform`，Windows 下路由到 PowerShell |
| **文件路径处理** | `\` vs `/`，`~` 无效 | 全局使用 `path.join()` + `os.homedir()` |
| **Browser Automation** | Playwright 官方支持 Windows | 直接可用；优先驱动 Edge（Windows 内置）|
| **Node.js 运行时** | 全面支持 Node.js 20+ on Windows | `node:sqlite` 内置，直接兼容 |
| **定时调度** | 纯 Node.js 实现，无 crontab 依赖 | 现有 SchedulerService 已兼容 |

---

## 技术架构演进

### 新增核心组件（Phase 14–18）

```
src/
├── core/
│   ├── webhook-repository.ts    # Webhook 配置持久化（Phase 14）
│   ├── nl2sql.ts                # Schema-Aware NL2SQL（Phase 15）
│   ├── knowledge-sync.ts        # 知识自动同步调度器（Phase 16）
│   └── runbook-engine.ts        # YAML Runbook → DAG（Phase 17）
├── skills/
│   ├── built-in/
│   │   ├── database-connector/  # NL2Insight DB 连接器（Phase 15）
│   │   ├── log-analyzer/        # 内部日志平台分析（Phase 17）
│   │   └── browser-automation/  # Playwright RPA（Phase 18）
│   └── adapters/
│       ├── knowledge-base/      # IKnowledgeBase 实现（Phase 16）
│       └── notification-hub/    # INotificationHub 实现（Phase 17）
web/src/app/
├── webhooks/                    # Webhook 管理 UI（Phase 14）
├── runbooks/                    # Runbook 管理 UI（Phase 17）
└── rpa/                         # RPA 会话管理 UI（Phase 18）
```

### 优先级矩阵

| 场景 | 业务价值 | 实现难度 | 推荐优先级 |
|------|---------|---------|-----------|
| **场景五：NL2Insight** | ★★★★★ | 低 | **P0 Week 1** |
| **场景二：活知识体系** | ★★★★★ | 中 | **P0 Week 1-2** |
| **场景三：AIOps** | ★★★★★ | 中 | **P1 Week 2-3** |
| **场景一：研发智能体** | ★★★★★ | 中 | **P1 Week 2-3** |
| **场景七：项目决策** | ★★★★☆ | 中 | **P2 Week 4** |
| **场景四：数字分身** | ★★★★☆ | 高 | **P2 Week 4-5** |
| **场景六：遗留 RPA** | ★★★★☆ | 高 | **P3 Week 5+** |

---

## 一天的 CMaster Bot（演示故事线）

```
08:55 → 为每位员工推送个性化工作日报（场景四）
09:00 → 夜间监控触发 Webhook → AI 自动完成 P2 故障定位+修复（场景三）
10:30 → 产品经理："上周哪个功能留存最差？" AI 30 秒给出答案+图表（场景五）
11:00 → 周会结束 → AI 自动生成纪要 + 创建行动项任务（场景四）
14:00 → 工程师提交代码 → AI 自动完成安全审查 + 文档同步（场景一）
16:30 → 知识库有更新 → AI 增量摄入 + 更新知识图谱关系（场景二）
23:00 → 定时巡检：预测"服务 X 磁盘 72h 后满"→ 创建运维任务（场景三）
```

---

## 扩展性设计总结

| 维度 | 现有机制 | 扩展方式 |
|------|---------|---------|
| 新增工具 | SKILL.md 协议 | 写一个 SKILL.md + index.ts |
| 新增外部系统 | ConnectorManager | 写一个 YAML 连接器配置 |
| 新增自动化场景 | SchedulerService + Cron | 配置定时表达式 |
| 新增触发方式 | Webhook 入站端点 | 任意系统 POST 即可触发 |
| 新增数据源 | ConnectorManager DB 驱动 | 添加 YAML + DB 驱动包 |
| 接入通知渠道 | notification-hub 适配器 | 实现 INotificationHub |
