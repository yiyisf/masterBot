# ADR 0017: HTTPS 代理适配 — https-proxy-agent 函数包装模式

**Status**: Accepted  
**Date**: 2026-05-17  
**Phase**: P10 — Web 版 MVP（Bug Fix）  
**Deciders**: yiyisf  

---

## Context

在系统代理环境（`HTTPS_PROXY=http://127.0.0.1:1087`）下，发起对话后后端抛出：

```
ERROR: Stream error: Connection error.
  cause: Client network socket disconnected before secure TLS connection was established
```

**根因诊断**：

1. Node.js 18+ 内置 `fetch` 不读取 `https_proxy` / `HTTPS_PROXY` 环境变量（由操作系统代理设置决定，浏览器内置支持，但 Node.js `fetch` 不支持）
2. OpenAI SDK v4 和 Anthropic SDK 内部使用 `node-fetch`（非 Node.js 内置 fetch）
3. `node-fetch` 的 `agent` 选项支持两种形式：
   - **实例形式**：`agent: new HttpsProxyAgent(url)` — 在 `https-proxy-agent@7+` 中会导致 TLS 握手失败（[upstream issue](https://github.com/TooTallNate/proxy-agents/issues/210)）
   - **函数形式**：`agent: () => new HttpsProxyAgent(url)` — 正常工作，TLS 握手成功

验证过程：
```bash
# 实例形式 → TLS 握手失败
node -e "const { HttpsProxyAgent } = require('https-proxy-agent'); ..."

# 函数形式 → HTTP 200 ✓
node -e "const agent = () => agentInstance; fetch(url, { agent })"
```

---

## Decision

**在两个 LLM 适配器构造函数中，将 `HttpsProxyAgent` 实例包装为函数形式**：

```typescript
// src/llm/openai.ts  &  src/llm/anthropic.ts
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
let httpAgent: import('http').Agent | undefined;
if (proxyUrl) {
    const proxyAgentInstance = new HttpsProxyAgent(proxyUrl);
    // 包装为函数，规避 https-proxy-agent@7+ 与 node-fetch 直连时的 TLS 兼容问题
    httpAgent = (() => proxyAgentInstance) as unknown as import('http').Agent;
}
```

**说明**：
- `as unknown as import('http').Agent` — TypeScript 类型强制转换，因为 `node-fetch` 的 `agent` 函数类型与 `http.Agent` 类型不兼容，但运行时 `node-fetch` 会检测 `typeof agent === 'function'` 并正确调用
- 四种代理环境变量按优先级读取：`https_proxy` → `HTTPS_PROXY` → `http_proxy` → `HTTP_PROXY`（兼容不同平台的大小写约定）
- 无代理时不注入 `httpAgent`（spread 条件展开），保持默认网络路径

**同时修复**：`config.baseUrl || undefined` 防止空字符串 `""` 传给 SDK（SDK 会将空字符串作为无效 baseURL 尝试请求）。

---

## Consequences

**正面影响**：
- 代理环境下 OpenAI 和 Anthropic 两个适配器均正常工作
- 非代理环境（`proxyUrl` 未定义）无任何性能影响
- 函数包装模式兼容 `https-proxy-agent@7+` 和未来版本（函数形式是 node-fetch 的稳定 API）

**负面影响**：
- `as unknown as http.Agent` 是类型强制转换，绕过了 TypeScript 类型安全
- 如果 OpenAI SDK 或 Anthropic SDK 未来将内部 HTTP 客户端从 `node-fetch` 迁移到 Node.js 内置 `fetch`，此 `httpAgent` 注入方式需要重新评估（Node.js 内置 fetch 使用不同的代理配置方式）

---

## Alternatives Considered

1. **升级到 `https-proxy-agent@9`（实例形式修复版）**：当前项目 `package.json` 已锁定 `@9.0.0`，该版本的实例形式仍有此问题。函数形式是已知稳定的工作方式。
2. **使用 `global-agent`**：通过 `GLOBAL_AGENT_HTTP_PROXY` 全局代理，无需修改各适配器。但 `global-agent` 会影响进程内所有 HTTP 请求（包括数据库连接、webhook 等），范围过广。拒绝。
3. **要求用户配置操作系统级代理（macOS 系统偏好/Windows 网络设置）**：部分 Node.js 版本支持读取系统代理，但不稳定，且 LTS Node.js 22 不支持。不可靠。
4. **迁移 OpenAI SDK 到 `fetch` 选项**：`openai@4` 支持 `fetch` 参数注入自定义 fetch，但需要包装代理逻辑。比函数形式更复杂，无额外收益。

---

## References

- `src/llm/openai.ts:34-53` — OpenAI 适配器代理注入
- `src/llm/anthropic.ts:20-31` — Anthropic 适配器代理注入
- [https-proxy-agent upstream issue #210](https://github.com/TooTallNate/proxy-agents/issues/210)
- commit `567a4cb` — fix(llm): 修复 https-proxy-agent@9 与 node-fetch TLS 握手失败问题
