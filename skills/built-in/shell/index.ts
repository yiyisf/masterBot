import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { SkillContext } from '../../../src/types.js';

const execAsync = promisify(exec);

/**
 * 执行 Shell 命令
 */
export async function execute(
    ctx: SkillContext,
    params: { command: string; cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { command, cwd, timeout = 30000 } = params;

    ctx.logger.info(`Executing command: ${command}`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: cwd || process.cwd(),
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB
        });

        return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
        return {
            stdout: error.stdout || '',
            stderr: error.stderr || error.message,
            exitCode: error.code || 1,
        };
    }
}

/**
 * 后台执行命令
 */
export async function execute_background(
    ctx: SkillContext,
    params: { command: string; cwd?: string }
): Promise<{ pid: number }> {
    const { command, cwd } = params;

    ctx.logger.info(`Spawning background command: ${command}`);

    const child = spawn(command, [], {
        cwd: cwd || process.cwd(),
        shell: true,
        detached: true,
        stdio: 'ignore',
    });

    child.unref();

    return { pid: child.pid || 0 };
}

export default { execute, execute_background };
