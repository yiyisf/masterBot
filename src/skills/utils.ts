import { platform, homedir } from 'os';
import { resolve, join } from 'path';
import { spawn } from 'child_process';

/**
 * 统一路径展开：处理 ~ 和 undefined 防御
 * 取代各 skill 中重复的 expandPath
 */
export function expandPath(p: unknown): string {
    if (!p || typeof p !== 'string') throw new Error('缺少必要参数 path：请提供文件路径');
    if (p.startsWith('~/') || p === '~') return resolve(join(homedir(), p.slice(1)));
    return resolve(p);
}

/**
 * 解析 CLI 命令名：Windows 自动加 .cmd 后缀
 * resolveCliCommand('claude') → 'claude.cmd'(Win) | 'claude'(Unix)
 */
export function resolveCliCommand(name: string): string {
    return platform() === 'win32' ? `${name}.cmd` : name;
}

/**
 * 调用外部 CLI，解决三大问题：
 *  1. stdio:['ignore','pipe','pipe'] 防 stdin 挂起
 *  2. 自动清除嵌套检测 env var（CLAUDECODE 等）
 *  3. Windows shell:true 支持 .cmd 脚本
 */
export function spawnCli(
    cmd: string,
    args: string[],
    opts: {
        cwd?: string;
        timeout?: number;
        stripEnvKeys?: string[];
        extraEnv?: Record<string, string>;
    } = {}
): Promise<string> {
    const {
        cwd = process.cwd(),
        timeout = 60_000,
        stripEnvKeys = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'GEMINI_CODE_SESSION'],
        extraEnv = {},
    } = opts;

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
    }
    Object.assign(env, extraEnv);
    for (const key of stripEnvKeys) delete env[key];

    return new Promise((resolve, reject) => {
        const isWin = platform() === 'win32';
        const child = spawn(cmd, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isWin,
            windowsHide: true,
        });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout?.on('data', (d: Buffer) => stdout.push(d));
        child.stderr?.on('data', (d: Buffer) => stderr.push(d));

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`CLI timeout after ${timeout / 1000}s`));
        }, timeout);

        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            const out = Buffer.concat(stdout).toString('utf-8');
            const err = Buffer.concat(stderr).toString('utf-8');
            if (code !== 0) reject(new Error(err.trim() || `Process exited with code ${code}`));
            else resolve(out);
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (err.code === 'ENOENT') {
                reject(new Error(`Command not found: ${cmd}. Please ensure it is installed and in PATH.`));
            } else {
                reject(err);
            }
        });
    });
}
