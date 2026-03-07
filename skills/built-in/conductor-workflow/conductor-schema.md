# Conductor OSS v3.21.20 — Workflow & Task Schema Reference

## WorkflowDef (工作流定义)

```json
{
  "name": "string (必填, snake_case)",
  "description": "string",
  "version": "number (默认 1)",
  "tasks": "TaskDef[] (必填, 任务 DAG 定义)",
  "inputParameters": ["string (输入参数名列表)"],
  "outputParameters": { "key": "${task_ref.output.field}" },
  "schemaVersion": 2,
  "restartable": true,
  "ownerEmail": "string",
  "timeoutPolicy": "TIME_OUT_WF | ALERT_ONLY",
  "timeoutSeconds": 0,
  "failureWorkflow": "string (失败补偿工作流名称)",
  "variables": {},
  "inputTemplate": {}
}
```

## TaskDef (任务定义)

通用字段（所有类型共有）:
```json
{
  "name": "string (任务名称)",
  "taskReferenceName": "string (必填, 工作流内唯一引用名)",
  "type": "TaskType (必填)",
  "description": "string",
  "inputParameters": { "key": "value 或 ${jsonpath}" },
  "optional": false,
  "asyncComplete": false,
  "startDelay": 0,
  "retryCount": 0,
  "timeoutSeconds": 0
}
```

## TaskType 详细定义

### SIMPLE (Worker 任务)
外部 Worker 执行的自定义任务。
```json
{ "name": "task_name", "taskReferenceName": "ref", "type": "SIMPLE" }
```

### HTTP (HTTP 请求)
```json
{
  "name": "http_call",
  "taskReferenceName": "http_ref",
  "type": "HTTP",
  "inputParameters": {
    "http_request": {
      "uri": "https://api.example.com/resource",
      "method": "GET|POST|PUT|DELETE",
      "headers": { "Content-Type": "application/json" },
      "body": {},
      "connectionTimeOut": 3000,
      "readTimeOut": 3000
    }
  }
}
```

### SWITCH (条件分支)
替代 DECISION（已废弃），基于表达式选择执行分支。
```json
{
  "name": "switch_task",
  "taskReferenceName": "switch_ref",
  "type": "SWITCH",
  "evaluatorType": "value-param | javascript",
  "expression": "switchCaseValue 或 JS表达式",
  "inputParameters": {
    "switchCaseValue": "${workflow.input.status}"
  },
  "decisionCases": {
    "approved": [{ "...TaskDef" }],
    "rejected": [{ "...TaskDef" }]
  },
  "defaultCase": [{ "...TaskDef" }]
}
```

### FORK_JOIN (并行分支)
并行执行多个分支，必须紧跟 JOIN 任务。
```json
{
  "name": "parallel",
  "taskReferenceName": "fork_ref",
  "type": "FORK_JOIN",
  "forkTasks": [
    [{ "...branch1_task1" }, { "...branch1_task2" }],
    [{ "...branch2_task1" }]
  ]
}
// 紧跟 JOIN:
{
  "name": "join",
  "taskReferenceName": "join_ref",
  "type": "JOIN",
  "joinOn": ["branch1_task2_ref", "branch2_task1_ref"]
}
```

### FORK_JOIN_DYNAMIC (动态并行)
运行时决定并行分支数量。
```json
{
  "name": "dynamic_fork",
  "taskReferenceName": "dfork_ref",
  "type": "FORK_JOIN_DYNAMIC",
  "inputParameters": {
    "dynamicTasks": "${prepare_ref.output.tasks}",
    "dynamicTasksInput": "${prepare_ref.output.inputs}"
  },
  "dynamicForkTasksParam": "dynamicTasks",
  "dynamicForkTasksInputParamName": "dynamicTasksInput"
}
```

### DO_WHILE (循环)
循环执行一组任务，直到条件为 false。
```json
{
  "name": "loop",
  "taskReferenceName": "loop_ref",
  "type": "DO_WHILE",
  "loopCondition": "if ($.loop_ref['iteration'] < $.loop_ref.output.maxRetries) { true; } else { false; }",
  "loopOver": [{ "...循环体内的TaskDef" }]
}
```

### SUB_WORKFLOW (子工作流)
同步调用另一个工作流。
```json
{
  "name": "sub_flow",
  "taskReferenceName": "sub_ref",
  "type": "SUB_WORKFLOW",
  "subWorkflowParam": {
    "name": "child_workflow_name",
    "version": 1
  },
  "inputParameters": {
    "param1": "${workflow.input.data}"
  }
}
```

### WAIT (等待)
暂停执行，等待外部信号或超时。
```json
{
  "name": "wait",
  "taskReferenceName": "wait_ref",
  "type": "WAIT",
  "inputParameters": {
    "duration": "1 hour"
  }
}
```

### HUMAN (人工审批)
暂停等待人工介入。
```json
{
  "name": "approval",
  "taskReferenceName": "human_ref",
  "type": "HUMAN"
}
```

### EVENT (事件发布)
发布事件到外部系统。
```json
{
  "name": "event",
  "taskReferenceName": "event_ref",
  "type": "EVENT",
  "sink": "conductor | sqs:queue_name | kafka:topic",
  "inputParameters": {
    "payload": "${workflow.input.data}"
  }
}
```

### TERMINATE (终止)
立即终止工作流。
```json
{
  "name": "terminate",
  "taskReferenceName": "term_ref",
  "type": "TERMINATE",
  "inputParameters": {
    "terminationStatus": "COMPLETED | FAILED",
    "terminationReason": "说明",
    "workflowOutput": {}
  }
}
```

### SET_VARIABLE (设置变量)
设置工作流级别变量。
```json
{
  "name": "set_var",
  "taskReferenceName": "setvar_ref",
  "type": "SET_VARIABLE",
  "inputParameters": {
    "myVar": "${some_task.output.value}"
  }
}
```

### JSON_JQ_TRANSFORM (JQ 转换)
使用 JQ 语法转换 JSON。
```json
{
  "name": "transform",
  "taskReferenceName": "jq_ref",
  "type": "JSON_JQ_TRANSFORM",
  "inputParameters": {
    "data": "${prev_task.output.result}",
    "queryExpression": ".data | map(select(.active == true))"
  }
}
```

### INLINE (内联脚本)
执行轻量级 JavaScript。
```json
{
  "name": "inline_eval",
  "taskReferenceName": "inline_ref",
  "type": "INLINE",
  "inputParameters": {
    "value": "${workflow.input.amount}",
    "evaluatorType": "graaljs",
    "expression": "function e() { return $.value > 100 ? 'high' : 'low'; } e();"
  }
}
```

### KAFKA_PUBLISH (Kafka 发布)
```json
{
  "name": "kafka_pub",
  "taskReferenceName": "kafka_ref",
  "type": "KAFKA_PUBLISH",
  "inputParameters": {
    "kafka_request": {
      "topic": "my-topic",
      "value": "${workflow.input.message}",
      "bootStrapServers": "localhost:9092",
      "headers": {},
      "key": "msg-key",
      "keySerializer": "org.apache.kafka.common.serialization.StringSerializer"
    }
  }
}
```

## JSONPath 变量引用语法

| 语法 | 说明 |
|------|------|
| `${workflow.input.fieldName}` | 工作流输入参数 |
| `${taskRefName.output.fieldName}` | 引用指定任务的输出 |
| `${taskRefName.input.fieldName}` | 引用指定任务的输入 |
| `${workflow.variables.varName}` | 工作流变量 |

## 最佳实践

1. **命名规范**: 工作流名 snake_case，taskReferenceName 在工作流内必须唯一
2. **错误处理**: 使用 `optional: true` 容忍非关键任务失败；设置 `failureWorkflow` 自动触发补偿
3. **超时**: 为关键任务设置 `timeoutSeconds`；工作流级别设置 `timeoutPolicy`
4. **重试**: 通过 `retryCount` 配置自动重试次数
5. **复杂流程拆解**: 超过 15 个任务的流程应拆为多个 SUB_WORKFLOW
6. **FORK_JOIN 规则**: 每个 FORK_JOIN 必须紧跟一个 JOIN，joinOn 列出每个分支的最后一个任务 ref
7. **SWITCH vs DECISION**: 始终使用 SWITCH（DECISION 已废弃）
8. **幂等性**: Worker 任务应设计为幂等，以支持安全重试
