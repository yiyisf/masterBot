# CMaster Bot — 演示脚本

> 竞赛现场演示用，共 5 个场景，建议总时长 15–20 分钟

---

## 演示前准备

1. 启动后端：`npm run dev`（根目录）
2. 启动前端：`cd web && npm run dev`
3. 浏览器打开 `http://localhost:3001`
4. 确认 `/health` 接口返回 `{"status":"ok"}`
5. 准备好演示用的 YAML 连接器文件（见场景二）

---

## 场景一：Auto-Skill Generator — AI 在 60 秒内生成新技能

### 背景

公司新接入了一套 HR 系统（REST API），需要 AI 具备查询员工信息的能力。传统做法：开发团队立项、排期、联调，至少一周。CMaster 的做法：告诉 AI 你想要什么，60 秒搞定。

### 演示步骤

1. 打开聊天界面，输入：

   ```
   我们有一个 HR 系统，REST API 地址是 https://hr.example.com/api，
   需要支持：查询员工基本信息（by 工号）、查询部门人员列表、
   查询员工的直属上级。请帮我生成一个技能。
   ```

2. 观察 Agent 的 Thought 步骤（实时流式显示）：
   - 分析 API 结构
   - 规划技能的动作定义
   - 生成 `SKILL.md` 内容
   - 生成 `index.ts` 实现代码

3. Agent 输出生成的 `SKILL.md`（片段）：

   ```markdown
   ---
   name: hr-query
   version: 1.0.0
   description: 查询 HR 系统员工信息
   author: auto-generated
   ---

   ### get_employee
   查询员工基本信息

   **参数**
   - `employee_id` (string, required): 员工工号
   ```

4. Agent 调用 `skill_generate` 工具，将文件写入 `skills/local/hr-query/`

5. 系统自动热加载，Agent 输出：

   ```
   技能 hr-query 已成功生成并加载到系统中。
   现在我可以用它帮你查询员工信息了。

   要试试吗？请告诉我员工工号。
   ```

6. 立刻测试：输入 `查询工号 EMP-1024 的员工信息`，Agent 使用刚生成的技能调用 HR API

### 亮点时刻

**从"描述需求"到"可用技能"，全程 60 秒，零代码，不重启服务器。**

这是 CMaster 与其他平台的根本区别：系统在运行时扩展自己的能力边界。

---

## 场景二：Enterprise Connector — 30 行 YAML 接入 ERP 系统

### 背景

企业 ERP 系统有数百个 API，以往接入需要大量样板代码。CMaster 的连接器框架让你用声明式 YAML 描述 API，系统自动生成完整技能。

### 演示步骤

1. 展示连接器 YAML 文件（`connectors/sap-erp.yaml`）：

   ```yaml
   connector:
     name: sap-erp
     version: 1.0.0
     description: SAP ERP 采购订单管理
     baseUrl: ${SAP_BASE_URL}
     auth:
       type: oauth2
       tokenUrl: ${SAP_TOKEN_URL}
       clientId: ${SAP_CLIENT_ID}
       clientSecret: ${SAP_CLIENT_SECRET}
     actions:
       - name: get_purchase_order
         description: 查询采购订单详情
         method: GET
         path: /sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/A_PurchaseOrder('{poNumber}')
         params:
           - name: poNumber
             type: string
             required: true
             description: 采购订单号
       - name: list_open_orders
         description: 列出所有待处理采购订单
         method: GET
         path: /sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/A_PurchaseOrder
         params:
           - name: filter
             type: string
             description: OData 过滤条件
   ```

2. 在聊天界面输入：

   ```
   加载连接器文件 connectors/sap-erp.yaml
   ```

3. 系统解析 YAML，生成技能，热加载，输出确认：

   ```
   连接器 sap-erp 已加载，包含 2 个动作：
   - get_purchase_order：查询采购订单详情
   - list_open_orders：列出待处理采购订单
   ```

4. 立即使用：

   ```
   查询采购订单 4500001234 的状态
   ```

5. Agent 调用 `sap-erp.get_purchase_order`，返回格式化结果

### 亮点时刻

**30 行 YAML = 一个完整的企业系统连接器。**

无需了解 SDK、无需编写 HTTP 客户端、无需处理 OAuth 流程，全部由框架自动处理。

---

## 场景三：Multi-Agent — 3 个 Agent 并行处理月末任务

### 背景

每月月末，财务需要汇总销售数据、HR 需要确认考勤、管理层需要生成综合报告。三件事互相依赖但又各自独立，传统方式需要串行等待，CMaster 的多 Agent 编排让三者并行执行。

### 演示步骤

1. 在聊天界面输入：

   ```
   请帮我处理本月月末任务：
   1. 从销售系统拉取本月销售数据并汇总
   2. 从 HR 系统获取本月考勤异常记录
   3. 基于上面两份数据生成月度管理报告

   任务 3 依赖任务 1 和 2 的结果。
   ```

2. Supervisor Agent 分析依赖关系，创建 DAG：

   ```
   已创建任务 DAG：

   [task-001] 销售数据汇总       → 状态: pending
   [task-002] 考勤异常提取       → 状态: pending
   [task-003] 月度报告生成       → 依赖: task-001, task-002 → 状态: waiting
   ```

3. 前端 DAG 可视化组件显示任务图，task-001 和 task-002 节点同时变为运行中（橙色）

4. 两个 Sub-Agent 并行执行：
   - Agent A 调用销售系统技能
   - Agent B 调用 HR 系统技能

5. task-001、task-002 先后完成（绿色），task-003 自动触发

6. Supervisor Agent 汇总两份数据，生成结构化月度报告，流式输出到聊天界面

7. 最终报告包含：销售额环比、考勤异常人员列表、管理建议

### 亮点时刻

**任务 1+2 并行执行，总耗时从 "串行 3 分钟" 缩短到 "并行 1.5 分钟"。**

DAG 引擎保证依赖顺序，`Promise.allSettled` 保证任意子任务失败不影响其他任务。

---

## 场景四：Proactive AI — 定时自动生成早报

### 背景

每天早上 9:00，团队需要一份包含昨日 Git 提交、Jira 任务进展、Slack 重要消息的早报。以往是人工汇总，耗时 30 分钟。CMaster 的主动式 AI 让系统自动完成。

### 演示步骤

1. 展示定时技能配置（`skills/local/standup-reporter/SKILL.md`）：

   ```markdown
   ---
   name: standup-reporter
   version: 1.0.0
   description: 每日早报自动生成器
   author: admin
   schedule: "0 9 * * 1-5"   # 周一至周五 09:00
   trigger:
     type: cron
     notify:
       - channel: slack
         target: "#dev-standup"
   ---
   ```

2. 在聊天界面手动触发演示（不等到明天 9 点）：

   ```
   立即执行一次今日早报生成
   ```

3. Agent 依次调用：
   - `git-skill.get_commits`：拉取昨日提交记录
   - `jira-skill.list_updated_issues`：获取已更新的 Jira 任务
   - `slack-skill.get_highlights`：提取重要消息摘要

4. 三个工具并行执行（Observation 流式显示）

5. Agent 整合数据，生成格式化早报：

   ```
   === 2026-02-25 技术团队早报 ===

   【昨日提交】共 12 个 commit
   - feat: Phase 9 AI/Tool/Skill 优化 (zhang)
   - fix: SKILL.md 参数解析问题 (zhang)

   【Jira 进展】3 个任务更新
   - CMASTER-45: Phase 10 基础修复 → In Review

   【Slack 要点】
   - 产品会议定于明日 14:00
   ```

6. 早报通过 notification 技能推送到 Slack `#dev-standup` 频道

7. 展示定时任务管理界面（Settings → Scheduled Tasks）

### 亮点时刻

**AI 不再只是"被动响应"，它主动在正确的时间完成正确的工作。**

定时触发 + 多技能协作 + 自动推送，真正实现"无人值守的工作自动化"。

---

## 场景五：Knowledge Graph — 多跳问答揭示公司架构

### 背景

公司文档散落在 Confluence、Word 文档、Slack 讨论中。普通 RAG 只能做相似度检索，回答不了需要"推理链"的问题。CMaster 的知识图谱支持多跳推理，真正理解组织架构和系统关系。

### 演示步骤

1. 展示知识导入（已预先完成）：系统已从以下来源提取实体和关系：
   - 组织架构文档（部门 → 团队 → 成员）
   - 系统架构文档（服务 → 依赖 → 数据库）
   - 项目文档（项目 → 负责人 → 关联系统）

2. 展示知识图谱浏览器（前端 Knowledge Graph 页面），可见节点和边

3. 输入第一个问题（单跳）：

   ```
   支付服务是哪个团队维护的？
   ```

   系统回答：
   ```
   支付服务由基础平台团队的张伟负责维护。
   （来源：系统架构文档 v3.2，2025-12）
   ```

4. 输入多跳问题：

   ```
   负责支付服务的团队，他们的上级部门负责人是谁？
   ```

   系统的推理路径（展示在 Thought 中）：
   ```
   1. 支付服务 → 维护团队: 基础平台团队
   2. 基础平台团队 → 所属部门: 技术中台部
   3. 技术中台部 → 负责人: 李明（VP Engineering）

   答: 李明（VP Engineering）
   ```

5. 输入复杂关联问题：

   ```
   如果支付服务发生故障，哪些业务系统会受到影响？
   受影响系统的 oncall 联系人分别是谁？
   ```

   系统进行图遍历：
   ```
   支付服务的下游依赖：
   - 订单系统（oncall: 王芳, 135-xxxx-xxxx）
   - 积分系统（oncall: 陈磊, 138-xxxx-xxxx）
   - 财务结算系统（oncall: 刘洋, 139-xxxx-xxxx）

   建议同时通知以上三位 oncall。
   ```

6. 展示向量 + 图谱混合检索效果对比：
   - 纯向量检索：只返回"支付服务相关文档片段"
   - GraphRAG：直接给出结构化答案 + 推理链

### 亮点时刻

**知识图谱让 AI 真正"理解"企业，而不只是"搜索"文档。**

多跳推理的答案精准、可溯源、带推理链，让企业知识真正变成可查询、可推理的数字资产。

---

## 演示总结

| 场景 | 核心技术 | 演示耗时 | 效果亮点 |
|------|---------|---------|---------|
| Auto-Skill Generator | 运行时代码生成 + 热加载 | ~3 分钟 | 60 秒 → 可用技能 |
| Enterprise Connector | YAML 声明式连接器 | ~3 分钟 | 30 行 → 完整集成 |
| Multi-Agent | DAG 并行编排 | ~4 分钟 | 3x 并行 → 2x 提速 |
| Proactive AI | 定时调度 + 多技能 | ~3 分钟 | 无人值守自动执行 |
| Knowledge Graph | GraphRAG 多跳推理 | ~4 分钟 | 结构化答案 + 推理链 |

**总计：~17 分钟**

---

## 备用演示（如时间充裕）

### MCP 生态接入
1. 打开 Settings → MCP Servers
2. 在 Registry 标签页搜索 "github"
3. 点击安装 `@modelcontextprotocol/server-github`
4. 系统自动配置 stdio 传输，注册工具
5. 在聊天中直接使用：`列出 cmasterBot 仓库最近 5 个 PR`

### 沙箱安全演示
1. 让 AI 尝试执行危险命令：`请删除 /tmp 目录下的所有文件`
2. 展示沙箱拦截 `rm -rf` 并返回安全拒绝信息
3. 修改配置为 allowlist 模式，仅允许 `ls`、`cat`、`grep`
4. 展示命令白名单生效
