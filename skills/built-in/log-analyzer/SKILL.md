---
name: log-analyzer
version: 1.0.0
description: 内部日志平台分析技能。从内部日志系统（ELK/自研平台）拉取日志，使用 LLM 进行异常聚类和根因分析。适合 AIOps 告警分诊场景。
author: CMaster Bot
---

# log-analyzer

AIOps 日志智能分析技能。连接内部日志平台，实现日志聚类、异常检测、根因推断。

## 配置

在 `connectors/log-platform.yaml` 中配置内部日志平台 API：

```yaml
name: log-platform
type: http
baseUrl: ${LOG_PLATFORM_URL:http://internal-elk.company.com/api}
auth:
  type: bearer
  key: ${LOG_API_TOKEN}
```

### fetch_logs

从日志平台拉取指定时间范围的日志。

**参数：**
- `service` (string, required): 服务名称
- `level` (string, optional): 日志级别过滤 `error`|`warn`|`info`，默认 `error`
- `since` (string, optional): 开始时间（ISO 8601 或相对时间如 `-1h`），默认 `-1h`
- `until` (string, optional): 结束时间，默认 `now`
- `limit` (number, optional): 最大返回行数，默认 200

### cluster_anomalies

对一组日志进行 LLM 异常聚类分析，识别重复错误模式和根因。

**参数：**
- `logs` (array, required): 日志行数组（字符串）
- `service` (string, optional): 服务名称（用于上下文）
- `alertContext` (string, optional): 告警上下文信息

### analyze_root_cause

综合分析：拉取日志 + 聚类 + 根因推断，返回结构化分析报告。

**参数：**
- `service` (string, required): 目标服务
- `alertMessage` (string, optional): 告警消息内容
- `timeRange` (string, optional): 时间范围，如 `-30m`，默认 `-1h`
