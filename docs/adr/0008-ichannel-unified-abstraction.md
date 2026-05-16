# ADR 0008: IChannel 统一 IM 渠道抽象

**Status**: Accepted  
**Date**: 2026-05-15  
**Phase**: P7 — 企业 IM 一等公民  
**Deciders**: yiyisf  

---

## Context

Phase 7 前，飞书集成以 `ImGateway` + `FeishuAdapter` 实现，钉钉尚未接入，WeCom / Teams 无法复用同一套代码。HitL 超时计时器直接内嵌在飞书适配器中，难以共享。

**安全问题**（Review 发现）：
- `verifyRequest()` 用字符串 `===` 比较 HMAC 签名，存在时序攻击（timing attack）漏洞
- `post()` 方法推送失败时静默吞错，调用方无法感知推送失败

**扩展问题**：
- 新增渠道（钉钉、WeCom、Teams）时需重复实现超时管理、健康检查、路由分发
- HitL 审批支持"带修改批准"第三态，旧 `FeishuAdapter` 接口无法表达

---

## Decision

**定义 `IChannel` 接口，所有渠道统一实现**：

```typescript
interface IChannel {
    name: string;
    send(msg: ChannelMessage): Promise<void>;
    verify(payload: unknown, headers: Record<string, string>): boolean;
    parseCallback(body: unknown): HitlCallback | null;
    health(): Promise<{ ok: boolean; latencyMs: number }>;
}
```

**关键设计决策**：

1. **`ChannelRouter` 替代 `ImGateway`**：多渠道注册/注销/路由，端点 `/api/channels/:channel/inbound`；保留旧 `/api/im/*` 向后兼容

2. **`HitlCardRenderer` 独立提取**：统一管理超时定时器（`Map<interruptId, NodeJS.Timeout>`），支持两种渠道 callback 格式解析

3. **`riskLevel` + `allowModify` 语义**：
   - `riskLevel: 'low' | 'medium' | 'high' | 'critical'` → 渠道卡片颜色（green/yellow/orange/red）
   - `allowModify: boolean` → 是否显示"✏️ 带修改批准"第三态按钮

4. **安全加固**（Review 必修）：
   - `verifyRequest()` 改用 `crypto.timingSafeEqual()`（飞书 HMAC-SHA256 hex 对比；钉钉 HMAC-SHA256 base64 对比）
   - `post()` 失败时 `throw new Error(msg)`，调用方可捕获

5. **WeCom / Teams stub**：实现 `IChannel` 接口，所有方法抛 `NotImplementedError`，预留 Phase 7.5

---

## Consequences

**正面影响**：
- 新增渠道只需实现 `IChannel` 接口（约 150 行），超时/路由/健康检查由 `HitlCardRenderer` / `ChannelRouter` 统一处理
- 时序攻击漏洞消除（`timingSafeEqual` 强制等时比较）
- `post()` 失败可被上层捕获，支持重试/告警

**负面影响**：
- `IChannel` 接口变化（如新增事件类型）需同步修改所有渠道实现
- WeCom / Teams 为 stub，用户配置后会得到 `NotImplementedError`，需清晰文档说明

---

## Alternatives Considered

1. **继续扩展 ImGateway**：单个类承载所有渠道逻辑，随渠道增加快速膨胀为"上帝类"。拒绝。
2. **独立路由（每渠道独立端点）**：如 `/api/feishu/inbound`、`/api/dingtalk/inbound`，需为每个渠道单独配置 webhook URL，运维复杂。拒绝。
3. **沿用字符串比较签名**：时序攻击实际利用难度较低，但属于已知安全漏洞类别，必须修复。拒绝。

---

## References

- `src/channels/types.ts`（IChannel 接口定义）
- `src/channels/feishu.ts`、`src/channels/dingtalk.ts`
- `src/channels/hitl-card-renderer.ts`
- `src/channels/router.ts`
