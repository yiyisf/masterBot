# ADR 0009: Admin Console 独立鉴权 — X-Admin-Key 与用户 API Key 分离

**Status**: Accepted  
**Date**: 2026-05-16  
**Phase**: P8 — Admin Console 基础  
**Deciders**: yiyisf  

---

## Context

Phase 8 引入面向 IT/安全/财务团队的管理后台，需要鉴权机制区分"普通用户"与"管理员"两类身份。

现有鉴权体系（`createAuthHook`）支持 `X-API-Key` header 或 JWT Bearer Token，适用于员工日常对话。管理操作（审批技能、修改 RBAC 规则、查看全量审计日志）需要更高权限，且需要：
- 独立于用户 API Key（用户 Key 泄露不应暴露管理面）
- 简单部署（无需完整 OAuth/LDAP 集成）
- 可在 Web 前端安全存储和使用

---

## Decision

**引入独立的 `X-Admin-Key` header 和 `createAdminHook`**，与现有用户鉴权完全隔离：

```
用户请求路径：X-API-Key / Authorization: Bearer <jwt>  → createAuthHook
管理请求路径：X-Admin-Key                              → createAdminHook
```

**关键设计**：

1. **Fastify plugin 封装**：`admin-router.ts` 使用 `app.register(async (instance) => { instance.addHook('onRequest', adminHook); ... })`，hook 作用域严格限于 `/api/admin/*` 路由，避免全局 hook + URL 前缀判断带来的 dangling Promise 泄漏

2. **多 Key 支持**：`adminApiKeys: string[]`，支持多个 Admin Key 同时有效（用于轮换）

3. **前端存储**：Admin Key 存储于 `localStorage`（key: `cmaster_admin_key`），通过 `web/src/lib/admin.ts` 统一管理，避免 5 个管理页面重复定义

4. **启动告警**：使用默认 key `admin-changeme` 时，服务器启动输出 WARN 日志，提示生产前替换

5. **审计日志**：所有管理操作写入 `admin_audit_log` 表，`admin_id` 取 Key 前 8 位（不存储完整 Key）

---

## Consequences

**正面影响**：
- 用户 Key 泄露不波及管理面（双 Key 独立）
- Fastify plugin 封装消除了 URL 前缀判断的性能损耗和 Promise 泄漏风险
- `web/src/lib/admin.ts` 共享 `adminFetch()` 函数，前端代码 DRY

**负面影响**：
- Admin Key 静态字符串，无法细粒度控制"哪个管理员能做什么"（RBAC 规则是存储层，尚未接入运行时执行）
- `localStorage` 存储 Key 存在 XSS 风险（与所有 localStorage-based auth 方案相同）；生产环境建议加 CSP Header

---

## Future Migration Path

Phase 9.5+ 引入完整 RBAC 运行时执行（`SkillRegistry` 接入 `rbac_rules` 表）后，Admin Key 可升级为：
- JWT with admin claims（区分不同管理员角色）
- SSO 集成（Phase 2.5 Identity 体系，若启动）

接口不变（`X-Admin-Key` header），只需替换 `createAdminHook` 实现。

---

## Alternatives Considered

1. **复用用户 Key + 特定前缀**（如 `admin_xxx`）：两类密钥同一 header，存在混用风险；无法在 Fastify 路由层做作用域隔离。拒绝。
2. **全局 onRequest hook + URL 前缀判断**：原始实现方式，当 auth 失败时 `reply.send()` 已发送响应但 Promise 仍挂起，导致 Fastify 报 "Reply already sent" warning 并内存泄漏。拒绝。
3. **OAuth 2.0 / OIDC**：企业级方案，但 Phase 8 目标是"快速上线基础管理面"，完整 OAuth 集成属于 Phase 2.5 Identity 范畴。推迟。

---

## References

- `src/gateway/auth.ts`（createAdminHook 实现）
- `src/gateway/admin-router.ts`（Fastify plugin 封装）
- `web/src/lib/admin.ts`（前端共享工具）
- `src/core/admin-repository.ts`（audit log 写入）
