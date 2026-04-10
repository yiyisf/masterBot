import { spawn } from 'child_process';
import { platform } from 'os';
import type { Logger } from '../types.js';
import { findGitBash } from './utils.js';

export interface OsSandboxOptions {
    cwd?: string;
    timeout?: number;
    /** Allow outbound network access (default: false on Linux bwrap) */
    allowNetwork?: boolean;
    logger?: Logger;
    /** Windows: prefer Git Bash over PowerShell (default: true) */
    preferGitBash?: boolean;
}

export interface OsSandboxResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    sandboxMode: 'sandbox-exec' | 'bwrap' | 'windows-restricted' | 'none';
}

/**
 * macOS Seatbelt profile — deny all by default, allow read-only FS + subprocess exec.
 * Network is denied. Writes only to /tmp and cwd.
 */
const MACOS_PROFILE = `
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/private/tmp"))
(allow sysctl-read)
(deny network*)
`.trim();

/**
 * Check if a binary exists on PATH (cross-platform: where on Windows, which on Unix).
 */
async function binExists(name: string): Promise<boolean> {
    return new Promise(resolve => {
        const cmd = platform() === 'win32' ? 'where' : 'which';
        const p = spawn(cmd, [name], { stdio: 'ignore' });
        p.on('close', code => resolve(code === 0));
        p.on('error', () => resolve(false));
    });
}

/**
 * Build the bwrap argument array for Linux.
 * Creates a minimal rootfs view, unshares network and PID namespaces.
 */
function buildBwrapArgs(command: string, cwd: string, allowNetwork: boolean): string[] {
    const args: string[] = [
        '--ro-bind', '/usr', '/usr',
        '--ro-bind', '/lib', '/lib',
        '--ro-bind', '/lib64', '/lib64',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf',
        '--proc', '/proc',
        '--dev', '/dev',
        '--tmpfs', '/tmp',
        '--bind', cwd, cwd,
        '--chdir', cwd,
        '--unshare-pid',
        '--die-with-parent',
    ];

    if (!allowNetwork) {
        args.push('--unshare-net');
    }

    args.push('--', '/bin/sh', '-c', command);
    return args;
}

/**
 * OS-Level sandbox executor.
 * Wraps shell command execution with kernel-level isolation.
 *
 * macOS  → sandbox-exec (Seatbelt / Apple Sandbox)
 * Linux  → bwrap (Bubblewrap)
 * Other  → direct execution (no OS-level isolation, rely on regex sandbox)
 */
export class OsSandboxExecutor {
    private readonly os: string;
    private hasBwrap: boolean | null = null;

    constructor(private logger?: Logger) {
        this.os = platform();
    }

    async execute(command: string, opts: OsSandboxOptions = {}): Promise<OsSandboxResult> {
        const { cwd = process.cwd(), timeout = 30000, allowNetwork = false, preferGitBash = true } = opts;

        if (this.os === 'darwin') {
            return this.execMacOS(command, cwd, timeout);
        }

        if (this.os === 'win32') {
            return this.execWindows(command, cwd, timeout, preferGitBash);
        }

        if (this.os === 'linux') {
            if (this.hasBwrap === null) {
                this.hasBwrap = await binExists('bwrap');
            }
            if (this.hasBwrap) {
                return this.execBwrap(command, cwd, timeout, allowNetwork);
            }
        }

        // Fallback: no OS-level sandbox available
        this.logger?.warn('[OsSandbox] No OS-level sandbox available, falling back to direct execution');
        return this.execDirect(command, cwd, timeout);
    }

    private async execMacOS(command: string, cwd: string, timeout: number): Promise<OsSandboxResult> {
        this.logger?.info(`[OsSandbox] macOS sandbox-exec: ${command}`);
        return this.spawnWrapped(
            'sandbox-exec',
            ['-p', MACOS_PROFILE, '/bin/sh', '-c', command],
            cwd,
            timeout,
            'sandbox-exec'
        );
    }

    private async execBwrap(command: string, cwd: string, timeout: number, allowNetwork: boolean): Promise<OsSandboxResult> {
        this.logger?.info(`[OsSandbox] Linux bwrap (net=${allowNetwork}): ${command}`);
        return this.spawnWrapped('bwrap', buildBwrapArgs(command, cwd, allowNetwork), cwd, timeout, 'bwrap');
    }

    private async execWindows(command: string, cwd: string, timeout: number, preferGitBash = true): Promise<OsSandboxResult> {
        // Prefer Git Bash for bash-syntax compatibility (mirrors Claude Code's approach)
        if (preferGitBash) {
            const bashPath = findGitBash();
            if (bashPath) {
                this.logger?.info(`[OsSandbox] Windows Git Bash: ${command}`);
                return this.spawnWrapped(bashPath, ['-c', command], cwd, timeout, 'windows-restricted');
            }
            this.logger?.warn('[OsSandbox] Git Bash not found, falling back to PowerShell');
        }

        // Fallback: restricted PowerShell
        this.logger?.info(`[OsSandbox] Windows restricted PowerShell: ${command}`);
        const args = [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Restricted',
            '-Command', command
        ];
        return this.spawnWrapped('powershell.exe', args, cwd, timeout, 'windows-restricted');
    }

    private async execDirect(command: string, cwd: string, timeout: number): Promise<OsSandboxResult> {
        // Use platform-appropriate shell to avoid ENOENT on Windows
        if (this.os === 'win32') {
            return this.spawnWrapped('cmd.exe', ['/c', command], cwd, timeout, 'none');
        }
        return this.spawnWrapped('/bin/sh', ['-c', command], cwd, timeout, 'none');
    }

    private spawnWrapped(
        bin: string,
        args: string[],
        cwd: string,
        timeout: number,
        sandboxMode: OsSandboxResult['sandboxMode']
    ): Promise<OsSandboxResult> {
        return new Promise(resolve => {
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            const child = spawn(bin, args, {
                cwd,
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
                    sandboxMode,
                });
            }, timeout);

            child.on('close', (code: number | null) => {
                clearTimeout(timer);
                resolve({
                    stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
                    stderr: Buffer.concat(stderrChunks).toString('utf-8'),
                    exitCode: code ?? 1,
                    sandboxMode,
                });
            });

            child.on('error', (err: NodeJS.ErrnoException) => {
                clearTimeout(timer);
                // If sandbox binary not found, fall back to direct execution
                if (err.code === 'ENOENT' && sandboxMode !== 'none') {
                    this.logger?.warn(`[OsSandbox] ${bin} not found (${sandboxMode}), falling back to direct`);
                    // Extract the actual user command from the sandbox args:
                    // - sandbox-exec: [..., '/bin/sh', '-c', <command>] → last arg
                    // - bwrap:        [..., '--', '/bin/sh', '-c', <command>] → last arg
                    // - powershell:   [..., '-Command', <command>] → last arg
                    const userCommand = args[args.length - 1] ?? '';
                    this.execDirect(userCommand, cwd, timeout).then(resolve);
                } else {
                    resolve({
                        stdout: '',
                        stderr: err.message,
                        exitCode: 1,
                        sandboxMode,
                    });
                }
            });
        });
    }
}
