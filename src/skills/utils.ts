import { platform, homedir } from 'os';
import { resolve, join, dirname } from 'path';
import { spawn, execFileSync } from 'child_process';
import { existsSync } from 'fs';

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

// 模块级缓存，整个进程生命周期内只探测一次
let _gitBashCache: string | null | undefined = undefined;

/**
 * Windows 专用：查找 Git Bash (bash.exe) 可执行文件路径
 * 参照 Claude Code 官方的 CLAUDE_CODE_GIT_BASH_PATH 机制。
 *
 * 优先级：
 *   1. 环境变量 CMASTER_GIT_BASH_PATH（用户显式指定）
 *   2. 从 `git` 命令路径推断（git.exe → ../../bin/bash.exe）
 *   3. 常见安装路径 fallback
 *   4. 返回 null（由调用方决定降级策略）
 *
 * 非 Windows 平台直接返回 null。结果被模块级缓存，只探测一次。
 */
export function findGitBash(): string | null {
    if (platform() !== 'win32') return null;
    if (_gitBashCache !== undefined) return _gitBashCache;

    // 1. 用户显式环境变量覆盖
    const envPath = process.env['CMASTER_GIT_BASH_PATH'];
    if (envPath && existsSync(envPath)) {
        return (_gitBashCache = envPath);
    }

    // 2. 从 git 命令位置推断 bash.exe
    //    git 路径通常是: C:\Program Files\Git\cmd\git.exe
    //    bash.exe 路径:  C:\Program Files\Git\bin\bash.exe
    try {
        const gitRaw = execFileSync('where', ['git'], {
            encoding: 'utf-8',
            timeout: 3000,
            windowsHide: true,
        });
        const gitPath = gitRaw.split('\n')[0]?.trim();
        if (gitPath) {
            const bashPath = resolve(join(dirname(gitPath), '..', 'bin', 'bash.exe'));
            if (existsSync(bashPath)) {
                return (_gitBashCache = bashPath);
            }
        }
    } catch {
        // where 命令失败：git 未安装或不在 PATH，继续 fallback
    }

    // 3. 常见安装路径 fallback
    const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        'C:\\Git\\bin\\bash.exe',
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return (_gitBashCache = candidate);
        }
    }

    return (_gitBashCache = null);
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
            } else if (err.code === 'EPERM' || err.code === 'EACCES') {
                const hint = platform() === 'win32'
                    ? 'Run as administrator or check execution policy: Set-ExecutionPolicy RemoteSigned'
                    : `Check file permissions: chmod +x ${cmd}`;
                reject(new Error(`Permission denied executing: ${cmd}. ${hint}`));
            } else {
                reject(err);
            }
        });
    });
}
