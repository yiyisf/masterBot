# Conductor OSS v3.21.20 — Golden Few-Shot Examples

> 每种模式给出一个最小可运行示例（不含可选字段），LLM 参考这些结构生成。

## Pattern 1: 顺序 HTTP 调用链

```json
{
  "name": "fetch_and_store",
  "description": "调用接口获取数据并存储",
  "version": 1,
  "schemaVersion": 2,
  "tasks": [
    {
      "name": "fetch_data",
      "taskReferenceName": "fetch_data_ref",
      "type": "HTTP",
      "inputParameters": {
        "http_request": {
          "uri": "${workflow.input.api_url}",
          "method": "GET",
          "headers": { "Authorization": "Bearer ${workflow.input.token}" },
          "connectionTimeOut": 3000,
          "readTimeOut": 5000
        }
      }
    },
    {
      "name": "store_result",
      "taskReferenceName": "store_result_ref",
      "type": "SIMPLE",
      "inputParameters": {
        "data": "${fetch_data_ref.output.response.body}",
        "target": "${workflow.input.target}"
      }
    }
  ],
  "outputParameters": {
    "result": "${store_result_ref.output.status}"
  }
}
```

## Pattern 2: FORK_JOIN 并行任务

```json
{
  "name": "parallel_checks",
  "description": "并行执行多项检查，全部完成后汇总",
  "version": 1,
  "schemaVersion": 2,
  "tasks": [
    {
      "name": "fork_checks",
      "taskReferenceName": "fork_checks_ref",
      "type": "FORK_JOIN",
      "forkTasks": [
        [
          {
            "name": "check_quota",
            "taskReferenceName": "check_quota_ref",
            "type": "SIMPLE",
            "inputParameters": { "resource": "${workflow.input.resource_id}" }
          }
        ],
        [
          {
            "name": "check_permission",
            "taskReferenceName": "check_perm_ref",
            "type": "SIMPLE",
            "inputParameters": { "user": "${workflow.input.user_id}" }
          }
        ]
      ]
    },
    {
      "name": "join_checks",
      "taskReferenceName": "join_checks_ref",
      "type": "JOIN",
      "joinOn": ["check_quota_ref", "check_perm_ref"]
    },
    {
      "name": "aggregate_results",
      "taskReferenceName": "aggregate_ref",
      "type": "SIMPLE",
      "inputParameters": {
        "quota_ok": "${check_quota_ref.output.allowed}",
        "perm_ok": "${check_perm_ref.output.allowed}"
      }
    }
  ]
}
```

## Pattern 3: SWITCH 条件分支

```json
{
  "name": "approval_routing",
  "description": "根据金额路由审批流",
  "version": 1,
  "schemaVersion": 2,
  "tasks": [
    {
      "name": "route_by_amount",
      "taskReferenceName": "route_ref",
      "type": "SWITCH",
      "evaluatorType": "value-param",
      "expression": "switchCaseValue",
      "inputParameters": {
        "switchCaseValue": "${workflow.input.approval_level}"
      },
      "decisionCases": {
        "high": [
          {
            "name": "director_approve",
            "taskReferenceName": "director_ref",
            "type": "HUMAN",
            "inputParameters": { "assignee": "director@corp.com" }
          }
        ],
        "low": [
          {
            "name": "manager_approve",
            "taskReferenceName": "manager_ref",
            "type": "HUMAN",
            "inputParameters": { "assignee": "manager@corp.com" }
          }
        ]
      },
      "defaultCase": [
        {
          "name": "auto_approve",
          "taskReferenceName": "auto_ref",
          "type": "SET_VARIABLE",
          "inputParameters": { "approved": true }
        }
      ]
    }
  ]
}
```

## Pattern 4: SUB_WORKFLOW 复杂业务拆解

```json
{
  "name": "ecs_provision_main",
  "description": "ECS 资源创建主工作流，通过子工作流拆解各阶段",
  "version": 1,
  "schemaVersion": 2,
  "tasks": [
    {
      "name": "pre_check",
      "taskReferenceName": "pre_check_ref",
      "type": "SUB_WORKFLOW",
      "inputParameters": {
        "subWorkflowParam": {
          "name": "ecs_pre_check",
          "version": 1
        },
        "region": "${workflow.input.region}",
        "instance_type": "${workflow.input.instance_type}"
      }
    },
    {
      "name": "create_instance",
      "taskReferenceName": "create_ref",
      "type": "SUB_WORKFLOW",
      "inputParameters": {
        "subWorkflowParam": {
          "name": "ecs_create_instance",
          "version": 1
        },
        "quota_ok": "${pre_check_ref.output.quota_ok}",
        "config": "${workflow.input.config}"
      }
    }
  ],
  "outputParameters": {
    "instance_id": "${create_ref.output.instance_id}"
  }
}
```

## Pattern 5: DO_WHILE 轮询等待

```json
{
  "name": "wait_for_ready",
  "description": "轮询资源状态直到 ready",
  "version": 1,
  "schemaVersion": 2,
  "tasks": [
    {
      "name": "poll_status",
      "taskReferenceName": "poll_ref",
      "type": "DO_WHILE",
      "loopCondition": "if ($.poll_check_ref['status'] == 'RUNNING') { true; } else { false; }",
      "loopOver": [
        {
          "name": "check_status",
          "taskReferenceName": "poll_check_ref",
          "type": "HTTP",
          "inputParameters": {
            "http_request": {
              "uri": "${workflow.input.status_url}",
              "method": "GET",
              "connectionTimeOut": 2000,
              "readTimeOut": 3000
            }
          }
        },
        {
          "name": "wait_interval",
          "taskReferenceName": "wait_ref",
          "type": "WAIT",
          "inputParameters": { "duration": "5 seconds" }
        }
      ]
    }
  ],
  "outputParameters": {
    "final_status": "${poll_check_ref.output.response.body.status}"
  }
}
```
