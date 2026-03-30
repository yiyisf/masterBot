import { spawn } from 'child_process';
import { platform } from 'os';
import type { SkillContext } from '../../../src/types.js';
import { CommandSandbox, type SandboxConfig } from '../../../src/skills/sandbox.js';
import { OsSandboxExecutor } from '../../../src/skills/os-sandbox.js';
import { expandPath, findGitBash } from '../../../src/skills/utils.js';

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
 * Get platform-appropriate shell for Windows direct-spawn fallback.
 * Priority: Git Bash (if available and preferred) → PowerShell
 */
function getWindowsShell(preferGitBash: boolean): { shell: string; hint: string } {
    if (preferGitBash) {
        const bashPath = findGitBash();
        if (bashPath) {
            return { shell: bashPath, hint: 'Git Bash syntax (Windows)' };
        }
    }
    return { shell: 'powershell.exe', hint: 'PowerShell syntax (Windows)' };
}

/**
 * 执行 Shell 命令（跨平台：Windows PowerShell / Unix bash）
 * 双层防御安全模型：
 *   Layer 1 — CommandSandbox (regex blocklist/allowlist) — 快速拦截明显恶意命令
 *   Layer 2 — OsSandboxExecutor (sandbox-exec / bwrap) — 内核级隔离执行容器
 */
export async function execute(
    ctx: SkillContext,
    params: { command: string; cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; platform: string }> {
    const { timeout = 30000 } = params;
    let { command } = params;
    const cwd = params.cwd ? expandPath(params.cwd) : process.cwd();

    // Layer 1: Application-level regex sandbox check (fast path)
    const sandbox = getSandbox(ctx);
    if (sandbox) {
        const check = sandbox.validate(command);
        if (!check.allowed) {
            return { stdout: '', stderr: `Command blocked: ${check.reason}`, exitCode: 126, platform: platform() };
        }
    }

    // Windows: 自动补 .exe 后缀，避免 AppX 虚拟化 EPERM（python/python3/pip/pip3）
    if (platform() === 'win32') {
        command = command.replace(/^(python3?|pip3?)\s/, '$1.exe ');
    }

    const preferGitBash = (ctx.config as any)?.skills?.shell?.preferGitBash !== false;

    ctx.logger.info(`Executing command: ${command}`);

    // Layer 2: OS-level sandbox (macOS sandbox-exec / Linux bwrap / Windows Git Bash or PowerShell)
    // OsSandboxExecutor handles all platforms including Windows; ENOENT fallback is done internally.
    const osSandbox = new OsSandboxExecutor(ctx.logger);
    const result = await osSandbox.execute(command, { cwd, timeout, preferGitBash });
    ctx.logger.info(`[OsSandbox] mode=${result.sandboxMode} exitCode=${result.exitCode}`);
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        platform: platform(),
    };
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

    const isWin = platform() === 'win32';
    let windowsShell = 'powershell.exe';
    if (isWin) {
        const preferGitBash = (ctx.config as any)?.skills?.shell?.preferGitBash !== false;
        windowsShell = getWindowsShell(preferGitBash).shell;
    }

    const child = spawn(command, [], {
        cwd,
        // On Windows use Git Bash (or PowerShell fallback); on Unix shell:true uses /bin/sh
        shell: isWin ? windowsShell : true,
        detached: true,
        stdio: 'ignore',
        ...(isWin ? { windowsHide: true } : {}),
    });

    child.unref();

    return { pid: child.pid || 0, platform: platform() };
}

export default { execute, execute_background, resolvePath };
