import { platform } from 'os';
import type { Logger } from '../types.js';

export interface SandboxConfig {
    enabled: boolean;
    mode: 'blocklist' | 'allowlist';
    blocklist?: string[];
    allowlist?: string[];
}

export interface SandboxResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Default dangerous command patterns (regex strings) — Unix/macOS
 */
const DEFAULT_BLOCKLIST: string[] = [
    'rm\\s+-[^\\s]*r[^\\s]*f',     // rm -rf, rm -fr, etc.
    'rm\\s+-[^\\s]*f[^\\s]*r',
    'rm\\s+--no-preserve-root',
    'mkfs',
    'dd\\s+if=',
    ':\\(\\)\\{\\s*:\\|:\\s*&\\s*\\};:', // fork bomb :(){ :|:& };:
    'chmod\\s+777',
    'chmod\\s+-R\\s+777',
    '>\\/dev\\/sd',
    'mv\\s+.*\\s+\\/dev\\/null',
    'wget\\s+.*\\|\\s*sh',
    'curl\\s+.*\\|\\s*sh',
    'curl\\s+.*\\|\\s*bash',
    'wget\\s+.*\\|\\s*bash',
    'shutdown',
    'reboot',
    'init\\s+[06]',
    'kill\\s+-9\\s+-1',
    'killall\\s+-9',
    'pkill\\s+-9',
    '>\\/etc\\/passwd',
    '>\\/etc\\/shadow',
];

/**
 * Default dangerous command patterns — Windows only
 */
const DEFAULT_BLOCKLIST_WIN32: string[] = [
    'format\\s+[a-zA-Z]:',          // 磁盘格式化
    'del\\s+.*\\/[sq]',              // 静默递归删除
    'rd\\s+.*\\/[sq]',               // 递归删目录
    'rmdir\\s+.*\\/[sq]',
    '\\bdiskpart\\b',                // 磁盘分区工具
    'cipher\\s+\\/w',               // 安全擦除磁盘
    'reg\\s+(delete|add).*hklm',    // 系统注册表写入
    'net\\s+user.*\\/add',          // 添加系统账户
    '\\bshutdown\\b.*\\/(s|r|h)',   // 关机/重启/休眠
    'taskkill\\s+\\/f\\s+\\/im',    // 强制终止所有进程
    '>\\s*(con|nul|prn|aux|com\\d|lpt\\d):', // 写入保留设备名
];

/**
 * Shell command sandbox validator
 */
export class CommandSandbox {
    private config: SandboxConfig;
    private blockPatterns: RegExp[];
    private allowPatterns: RegExp[];
    private logger?: Logger;

    constructor(config: SandboxConfig, logger?: Logger, platformOverride?: string) {
        this.config = config;
        this.logger = logger;

        const os = platformOverride ?? platform();
        const defaultList = os === 'win32'
            ? [...DEFAULT_BLOCKLIST, ...DEFAULT_BLOCKLIST_WIN32]
            : DEFAULT_BLOCKLIST;

        const blocklist = config.blocklist?.length ? config.blocklist : defaultList;
        this.blockPatterns = blocklist.map(p => new RegExp(p, 'i'));
        this.allowPatterns = (config.allowlist || []).map(p => new RegExp(`^${p}`, 'i'));
    }

    validate(command: string): SandboxResult {
        if (!this.config.enabled) {
            return { allowed: true };
        }

        const trimmed = command.trim();

        if (this.config.mode === 'allowlist') {
            const allowed = this.allowPatterns.some(p => p.test(trimmed));
            if (!allowed) {
                const reason = `Command not in allowlist: ${trimmed}`;
                this.logger?.warn(`[Sandbox] ${reason}`);
                return { allowed: false, reason };
            }
            return { allowed: true };
        }

        // blocklist mode (default)
        for (const pattern of this.blockPatterns) {
            if (pattern.test(trimmed)) {
                const reason = `Command matched blocklist pattern: ${pattern.source}`;
                this.logger?.warn(`[Sandbox] Blocked command: ${trimmed} (${reason})`);
                return { allowed: false, reason };
            }
        }

        return { allowed: true };
    }
}
