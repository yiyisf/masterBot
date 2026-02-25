---
name: hr-api
version: 1.0.0
description: 与 HR 系统 REST API 交互，支持查询员工信息、部门人员列表和直属上级。
author: Auto-Generated
---

### get_employee_info

通过工号查询员工基本信息，返回员工的姓名、工号、部门、职位等信息。

**Parameters:**
- `employeeId` (string, required): 员工工号

### get_department_employees

查询部门人员列表，返回指定部门的所有员工信息。

**Parameters:**
- `departmentId` (string, required): 部门ID

### get_direct_supervisor

查询员工的直属上级，返回上级的员工信息。

**Parameters:**
- `employeeId` (string, required): 员工工号