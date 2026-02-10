import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SkillContext } from '../../../src/types.js';

const execFileAsync = promisify(execFile);

/**
 * 向 Claude Code 提问或执行编码任务
 */
export async function ask(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; allowed_tools?: string; system_prompt?: string }
): Promise<string> {
    const { prompt, cwd, allowed_tools, system_prompt } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    const args = ['-p', prompt, '--output-format', 'json'];
    if (allowed_tools) args.push('--allowedTools', allowed_tools);
    if (system_prompt) args.push('--append-system-prompt', system_prompt);

    ctx.logger.info(`Claude Code ask: ${prompt.slice(0, 100)}...`);

    try {
        const { stdout } = await execFileAsync('claude', args, {
            cwd: cwd || process.cwd(),
            timeout: 300_000, // Claude Code tasks may take longer
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
        });

        try {
            const result = JSON.parse(stdout);
            return typeof result.result === 'string' ? result.result : JSON.stringify(result, null, 2);
        } catch {
            return stdout.trim();
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return 'Error: Claude Code CLI not found. Please install it first.';
        }
        return `Error: ${error.stderr || error.message}`;
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
        allowed_tools: 'Read', // Read-only access for reviews
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

    const args = ['-p', prompt, '--output-format', 'json'];
    if (session_id) args.push('--resume', session_id);
    else args.push('--continue');

    ctx.logger.info(`Claude Code continue_session: ${prompt.slice(0, 100)}...`);

    try {
        const { stdout } = await execFileAsync('claude', args, {
            timeout: 300_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
        });

        try {
            const result = JSON.parse(stdout);
            return typeof result.result === 'string' ? result.result : JSON.stringify(result, null, 2);
        } catch {
            return stdout.trim();
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return 'Error: Claude Code CLI not found. Please install it first.';
        }
        return `Error: ${error.stderr || error.message}`;
    }
}

export default { ask, code_review, continue_session };
