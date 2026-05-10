/**
 * Task 5c: Memory Injection Hook
 * 在 UserPromptSubmit 时检索长期记忆，将相关记忆附加到 prompt（供 ClaudeManagedAgent 使用）。
 * LegacySelfHostedAgent 内部已有注入逻辑，此 hook 为未来 SDK Agent 准备。
 */

import type { UserPromptSubmitEvent, HookResult } from '../types.js';
import type { LongTermMemory } from '../../../memory/long-term.js';

export function createMemoryInjectionHook(longTermMemory: LongTermMemory) {
    return async (event: UserPromptSubmitEvent): Promise<HookResult | void> => {
        let memories: Array<{ content: string }> = [];
        try {
            memories = await longTermMemory.search(event.prompt, 3);
        } catch {
            return;
        }

        if (memories.length === 0) return;

        const memBlock = memories.map(m => `- ${m.content}`).join('\n');
        const injected = `[Relevant memories]\n${memBlock}\n\n${event.prompt}`;

        return {
            modified: {
                ...event,
                prompt: injected,
            },
        };
    };
}
