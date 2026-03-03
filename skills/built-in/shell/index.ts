import { spawn } from 'child_process';
import { platform } from 'os';
import type { SkillContext } from '../../../src/types.js';
import { CommandSandbox, type SandboxConfig } from '../../../src/skills/sandbox.js';
import { expandPath } from '../../../src/skills/utils.js';

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
 * 使用 spawn 替代 exec，支持 EPERM/EACCES 友好错误提示
 */
export async function execute(
    ctx: SkillContext,
    params: { command: string; cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; platform: string }> {
    const { timeout = 30000 } = params;
    let { command } = params;
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
    const isWin = platform() === 'win32';

    // Windows: python/python3 命令自动补 .exe 避免 AppX 虚拟化 EPERM
    if (isWin && /^python3?\s/.test(command)) {
        command = command.replace(/^python3?\s/, 'python.exe ');
    }

    ctx.logger.info(`Executing command [${hint}]: ${command}`);

    return new Promise((resolve) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const child = spawn(command, [], {
            cwd,
            shell: shell as string,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
        child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

        const timer = setTimeout(() => {
            child.kill();
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
                stderr: `Command timed out after ${timeout / 1000}s`,
                exitCode: 124,
                platform: platform(),
            });
        }, timeout);

        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
                stderr: Buffer.concat(stderrChunks).toString('utf-8'),
                exitCode: code ?? 1,
                platform: platform(),
            });
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            let errMsg: string;
            if (err.code === 'ENOENT') {
                errMsg = `命令未找到: ${command.split(' ')[0]}。请确认已安装并在 PATH 中。`;
            } else if (err.code === 'EPERM' || err.code === 'EACCES') {
                errMsg = isWin
                    ? `权限不足，无法执行: ${command}。\n请以管理员身份运行，或检查执行策略: Set-ExecutionPolicy RemoteSigned`
                    : `权限不足，无法执行: ${command}。\n请检查文件权限: chmod +x <file>`;
            } else {
                errMsg = err.message;
            }
            resolve({
                stdout: '',
                stderr: errMsg,
                exitCode: 1,
                platform: platform(),
            });
        });
    });
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
