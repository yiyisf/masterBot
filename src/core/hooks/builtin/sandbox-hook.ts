/**
 * Task 5a: Sandbox Hook
 * 在 PreToolUse 时校验 shell 工具命令，不合规则 abort。
 */

import type { PreToolUseEvent, HookResult } from '../types.js';
import { CommandSandbox, type SandboxConfig } from '../../../skills/sandbox.js';

const SHELL_TOOL_NAMES = new Set(['shell', 'bash', 'run_command', 'execute_command']);

export function createSandboxHook(config: SandboxConfig) {
    const sandbox = new CommandSandbox(config);

    return async (event: PreToolUseEvent): Promise<HookResult | void> => {
        if (!SHELL_TOOL_NAMES.has(event.toolName)) return;

        const command = (event.toolInput['command'] as string | undefined) ?? '';
        if (!command) return;

        const result = sandbox.validate(command);
        if (!result.allowed) {
            return {
                abort: true,
                modified: {
                    ...event,
                    toolInput: {
                        ...event.toolInput,
                        _blocked: result.reason ?? 'Command blocked by sandbox policy',
                    },
                },
            };
        }
    };
}
