import { resolve, sep } from 'path';
import type { SkillContext } from '../../../src/types.js';
import { expandPath, resolveCliCommand, spawnCli } from '#skill-kit/skills/utils.js';

const CLAUDE_STRIP_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

/**
 * P0-5 治理后门处置：子进程内部的工具调用完全绕过 CMaster 的 shell 沙箱/Hook/权限体系，
 * 因此这里设一道独立的硬上限——即使调用方（LLM）请求更宽的 allowed_tools，也会被裁剪到
 * 此集合内，杜绝通过本 skill 间接获得无治理的 Bash/Write/Edit 能力。
 * 完整方案见迁移路线图（Managed Agent 承接，claude-agent-sdk 引擎自带 canUseTool 治理）。
 */
const MAX_ALLOWED_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const DEFAULT_ALLOWED_TOOLS = 'Read,Grep,Glob';

function sanitizeAllowedTools(requested?: string): string {
    if (!requested) return DEFAULT_ALLOWED_TOOLS;
    const filtered = requested.split(',').map(s => s.trim()).filter(t => MAX_ALLOWED_TOOLS.has(t));
    return filtered.length > 0 ? filtered.join(',') : DEFAULT_ALLOWED_TOOLS;
}

/**
 * P0-5: cwd 收敛到项目根目录（process.cwd()）内，禁止越权访问根目录以外的文件系统路径。
 */
function resolveSafeCwd(rawCwd?: string): string {
    const root = resolve(process.cwd());
    if (!rawCwd) return root;
    const resolved = expandPath(rawCwd);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`cwd 必须位于项目根目录内 (${root})，拒绝越权路径: ${resolved}`);
    }
    return resolved;
}

function parseClaudeOutput(raw: string): string {
    try {
        const result = JSON.parse(raw);
        return typeof result.result === 'string' ? result.result : JSON.stringify(result, null, 2);
    } catch {
        return raw.trim();
    }
}

/**
 * 向 Claude Code 提问或执行编码任务
 */
export async function ask(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; allowed_tools?: string; system_prompt?: string }
): Promise<string> {
    const { prompt, allowed_tools, system_prompt } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    let safeCwd: string;
    try {
        safeCwd = resolveSafeCwd(params.cwd);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }

    const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', sanitizeAllowedTools(allowed_tools)];
    if (system_prompt) args.push('--append-system-prompt', system_prompt);

    ctx.logger.info(`Claude Code ask: ${prompt.slice(0, 100)}...`);

    try {
        const raw = await spawnCli(resolveCliCommand('claude'), args, {
            cwd: safeCwd,
            timeout: 300_000,
            stripEnvKeys: CLAUDE_STRIP_KEYS,
        });
        return parseClaudeOutput(raw);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
}

/**
 * 代码审查
 */
export async function code_review(
    ctx: SkillContext,
    params: { target: string; cwd?: string; focus?: string }
): Promise<string> {
    const { target, cwd, focus } = params;

    const reviewPrompt = focus
        ? `Review ${target} focusing on ${focus}. Provide actionable findings.`
        : `Review ${target}. Identify bugs, security issues, and improvements.`;

    return ask(ctx, {
        prompt: reviewPrompt,
        cwd,
        allowed_tools: 'Read',
    });
}

/**
 * 继续上一次 Claude Code 会话
 */
export async function continue_session(
    ctx: SkillContext,
    params: { prompt: string; session_id?: string }
): Promise<string> {
    const { prompt, session_id } = params;
    if (!prompt) return 'Error: prompt parameter is required';
    if (!session_id) {
        // P0-5: `claude --continue` 续接的是本机最近使用的会话（跨进程/跨用户全局状态），
        // 在多会话并发场景下会续到别人的对话。显式要求 session_id，拒绝隐式的全局续接。
        return 'Error: session_id parameter is required (implicit --continue is disabled to prevent cross-session leakage; pass the session_id returned by a prior ask/code_review call)';
    }

    const args = ['-p', prompt, '--output-format', 'json', '--resume', session_id];

    ctx.logger.info(`Claude Code continue_session: ${prompt.slice(0, 100)}...`);

    try {
        const raw = await spawnCli(resolveCliCommand('claude'), args, {
            timeout: 300_000,
            stripEnvKeys: CLAUDE_STRIP_KEYS,
        });
        return parseClaudeOutput(raw);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
}

export default { ask, code_review, continue_session };
