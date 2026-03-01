---
name: hr-portal
version: 1.0.0
description: HR 人力资源门户技能，提供员工查询、假期管理、组织架构、薪资摘要和人事政策查询
author: CMaster Team
---

# HR Portal Skill

对接企业 HR 系统，提供人事相关数据的查询与操作能力。

支持通过环境变量 `HR_API_URL` + `HR_API_KEY` 对接真实 HR 系统（如 Workday、SAP SuccessFactors、钉钉 HR 等）；未配置时使用内置演示数据运行。

## Actions

### search_employee
搜索员工信息

- **参数**: `query` (string, 必填) - 搜索关键词（姓名、工号、部门、邮箱）
- **参数**: `department` (string) - 按部门过滤，可选
- **参数**: `limit` (number) - 返回数量上限，默认 10
- **返回**: 匹配的员工列表（工号、姓名、部门、职位、邮箱、直属上级）

### get_leave_balance
查询员工假期余额

- **参数**: `employee_id` (string, 必填) - 员工工号
- **参数**: `year` (number) - 查询年份，默认当前年
- **返回**: 各类假期的已用、剩余天数（年假、病假、调休、婚假等）

### submit_leave_request
提交请假申请

- **参数**: `employee_id` (string, 必填) - 申请人工号
- **参数**: `leave_type` (string, 必填) - 假期类型：annual（年假）/ sick（病假）/ comp（调休）/ personal（事假）/ other（其他）
- **参数**: `start_date` (string, 必填) - 开始日期，格式 YYYY-MM-DD
- **参数**: `end_date` (string, 必填) - 结束日期，格式 YYYY-MM-DD
- **参数**: `reason` (string) - 请假原因，可选
- **返回**: 申请单号和当前状态

### get_org_chart
查询组织架构

- **参数**: `department` (string) - 部门名称，为空则返回顶层架构
- **参数**: `depth` (number) - 展示层级深度，默认 2
- **返回**: 部门树形结构（包含负责人、人员数量、子部门）

### get_payroll_summary
查询薪资摘要（脱敏）

- **参数**: `employee_id` (string, 必填) - 员工工号
- **参数**: `month` (string) - 月份，格式 YYYY-MM，默认上月
- **返回**: 当月薪资构成摘要（税前总额、各项明细比例，不返回精确金额）

### list_hr_policies
查询人事制度与政策

- **参数**: `category` (string) - 政策分类：leave（假期制度）/ attendance（考勤）/ benefits（福利）/ performance（绩效）/ onboarding（入职）/ offboarding（离职）
- **参数**: `keyword` (string) - 关键词搜索，可选
- **返回**: 相关政策条款列表
