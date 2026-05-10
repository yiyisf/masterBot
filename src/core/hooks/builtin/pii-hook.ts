/**
 * Task 5d: PII Redaction Hook (stub)
 * Phase 2 仅实现框架，Phase 6 引入真正的 PII 检测模型。
 *
 * 当前实现：对 UserPromptSubmit.rawPrompt 标记为已处理（无实际脱敏）。
 * 合规团队可在此插入 presidio / AWS Comprehend 等实现。
 */

import type { UserPromptSubmitEvent, HookResult } from '../types.js';

export interface PiiRedactorConfig {
    /** Phase 6 占位：启用后将调用外部 PII 服务 */
    enabled: boolean;
}

export function createPiiHook(_config: PiiRedactorConfig) {
    return async (_event: UserPromptSubmitEvent): Promise<HookResult | void> => {
        // Phase 6 TODO: 调用 PII 检测服务，替换 email/phone/SSN 等
        return;
    };
}
