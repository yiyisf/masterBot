import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import type { SkillContext } from '../../../src/types.js';
import { CommandSandbox, type SandboxConfig } from '../../../src/skills/sandbox.js';
import { expandPath } from '../../../src/skills/utils.js';

const execAsync = promisify(exec);

function getSandbox(ctx: SkillContext): CommandSandbox | null {
    const sandboxConfig = (ctx.config as any)?.sandbox as SandboxConfig | undefined;
    if (!sandboxConfig) return null;
    return new CommandSandbox(sandboxConfig, ctx.logger);
}

/**
 * Resolve cross-platform path: handles ~ and path separators
 * @deprecated 请使用 expandPath from utils.ts；此别名保留向后兼容
 */
export const resolvePath = expandPath;

/**
 * Get platform-appropriate shell config
 */
function getShellConfig(): { shell: string | boolean; hint: string } {
    if (platform() === 'win32') {
        return {
            shell: 'powershell.exe',
            hint: 'PowerShell syntax (Windows)',
        };
    }
    return {
        shell: '/bin/sh',
        hint: 'bash syntax',
    };
}

/**
 * 执行 Shell 命令（跨平台：Windows PowerShell / Unix bash）
 */
export async function execute(
    ctx: SkillContext,
    params: { command: string; cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; platform: string }> {
    const { command, timeout = 30000 } = params;
    const cwd = params.cwd ? expandPath(params.cwd) : process.cwd();

    // Sandbox check
    const sandbox = getSandbox(ctx);
    if (sandbox) {
        const check = sandbox.validate(command);
        if (!check.allowed) {
            return { stdout: '', stderr: `Command blocked: ${check.reason}`, exitCode: 126, platform: platform() };
        }
    }

    const { shell, hint } = getShellConfig();
    ctx.logger.info(`Executing command [${hint}]: ${command}`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB
            shell: shell as string,
        });

        return { stdout, stderr, exitCode: 0, platform: platform() };
    } catch (error: any) {
        return {
            stdout: error.stdout || '',
            stderr: error.stderr || error.message,
            exitCode: error.code || 1,
            platform: platform(),
        };
    }
}

/**
 * 后台执行命令（跨平台）
 */
export async function execute_background(
    ctx: SkillContext,
    params: { command: string; cwd?: string }
): Promise<{ pid: number; platform: string } | { stdout: string; stderr: string; exitCode: number; platform: string }> {
    const { command } = params;
    const cwd = params.cwd ? expandPath(params.cwd) : process.cwd();

    // Sandbox check
    const sandbox = getSandbox(ctx);
    if (sandbox) {
        const check = sandbox.validate(command);
        if (!check.allowed) {
            return { stdout: '', stderr: `Command blocked: ${check.reason}`, exitCode: 126, platform: platform() };
        }
    }

    ctx.logger.info(`Spawning background command: ${command}`);

    const child = spawn(command, [], {
        cwd,
        shell: true,
        detached: true,
        stdio: 'ignore',
    });

    child.unref();

    return { pid: child.pid || 0, platform: platform() };
}

export default { execute, execute_background, resolvePath };
