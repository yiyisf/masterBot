# ADR 0002: Local-First Distribution — 员工本地分发模式

**Status**: Accepted  
**Date**: 2026-05-10  
**Deciders**: yiyisf  

---

## Context

masterBot v1/v2 设想为中心化 SaaS 平台。但在企业 B2B 场景中，以下约束导致 SaaS 模式存在根本性问题：

- **数据主权**：企业不愿意把员工对话、内部文档发到第三方服务器
- **零信任合规**：企业内网 AI 访问需经过审计，中心服务器扩大攻击面
- **运维成本**：SaaS 需要多租户隔离、SLA、弹性伸缩，维护成本远超团队规模
- **AI PC 趋势**：2026 年 Intel/AMD/Apple Silicon 主流笔记本均内置 NPU，本地推理能力显著提升

---

## Decision

**采用本地分发模式**（Local-First, Cloud-Augmented）：

```
员工 PC（本地）                    中心服务（轻量）
┌──────────────────────┐          ┌──────────────────────┐
│ masterBot Desktop    │          │ Skill Registry        │
│ · Next.js Web UI     │←─sync──→│ LLM Gateway           │
│ · Fastify 后端       │          │ 审计回传接口            │
│ · SQLite 本地 DB     │          │ SSO/SCIM 集成          │
│ · 本地 Skills        │          └──────────────────────┘
└──────────────────────┘
```

**核心原则**：
- 对话数据、本地技能、工具执行结果 → 留在员工 PC
- LLM 调用、技能同步、审计日志 → 经由中心服务转发/回传
- 离线时基本功能可用（缓存的技能 + 本地模型 Ollama）

---

## Consequences

**正面影响**：
- 数据主权完全归企业，免除 GDPR/SOC2 合规审查压力
- 中心服务规模可控（3–5 个轻量服务），无需 Kubernetes 集群
- 员工端响应速度极快（毫秒级本地响应，无网络往返）
- 适配 AI PC 趋势，可利用 NPU 运行本地模型

**负面影响**：
- 客户端升级管理复杂（需三轨升级体系，见 Phase 15）
- 审计日志需异步回传，有延迟窗口（最大 5 分钟，可配置）
- 初期 Web 版先于桌面应用上线（Web-First 策略，Phase 10），Desktop 在 Phase 14

---

## Alternatives Considered

1. **中心化 SaaS**：多租户复杂度高、数据主权问题、运维负担超出团队能力。拒绝。
2. **纯本地离线**：缺少技能同步、审计回传、SSO 集成。拒绝。

---

## References

- [优化方案 v3 最终版](../refactor-plan/masterBot优化方案_v3_最终版.md) §第 1 章、第 5 章
- [优化方案 v3.1 增量](../refactor-plan/masterBot优化方案_v3.1_增量补充.md) §第 5 章（Web-First）
