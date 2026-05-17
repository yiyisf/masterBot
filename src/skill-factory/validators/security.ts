import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SecurityScanResult } from '../types.js';

type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

interface BuiltinRule {
    id: string;
    pattern: RegExp;
    severity: RuleSeverity;
    message: string;
}

const BUILTIN_RULES: BuiltinRule[] = [
    { id: 'hardcoded-api-key', pattern: /(?:sk|pk|api|key)[_-]?(?:secret|token|key)\s*=\s*['"][a-zA-Z0-9_-]{20,}['"]/i, severity: 'critical', message: '疑似硬编码 API key' },
    { id: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/, severity: 'critical', message: 'AWS Access Key 泄露' },
    { id: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/, severity: 'critical', message: 'OpenAI API Key 疑似泄露' },
    { id: 'github-token', pattern: /ghp_[A-Za-z0-9]{36}/, severity: 'critical', message: 'GitHub Personal Access Token 泄露' },
    { id: 'slack-token', pattern: /xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/, severity: 'critical', message: 'Slack Bot Token 泄露' },
    { id: 'cmd-injection-exec-template', pattern: /exec\s*\(\s*`[^`]*\$\{/, severity: 'high', message: '命令注入风险：exec 模板字符串' },
    { id: 'cmd-injection-spawn-sh', pattern: /spawn\s*\(\s*['"]sh['"]/, severity: 'high', message: '命令注入风险：spawn sh' },
    { id: 'eval-usage', pattern: /\beval\s*\(/, severity: 'high', message: '禁止使用 eval()' },
    { id: 'new-function', pattern: /new\s+Function\s*\(/, severity: 'high', message: '禁止使用 new Function()' },
    { id: 'sql-injection-template', pattern: /`\s*SELECT[\s\S]*?\$\{/, severity: 'high', message: 'SQL 注入风险：模板字符串拼接 SELECT' },
    { id: 'sql-injection-insert', pattern: /`\s*INSERT[\s\S]*?\$\{/, severity: 'high', message: 'SQL 注入风险：模板字符串拼接 INSERT' },
    { id: 'path-traversal', pattern: /\.\.\//g, severity: 'medium', message: '路径遍历风险 (../)' },
    { id: 'process-exit', pattern: /process\.exit\s*\(/, severity: 'medium', message: '不应调用 process.exit()' },
    { id: 'require-dynamic', pattern: /require\s*\(\s*[^'"[]/, severity: 'medium', message: '动态 require 可能导致代码注入' },
    { id: 'xmlhttprequest', pattern: /XMLHttpRequest/, severity: 'low', message: '建议使用 fetch() 替代 XMLHttpRequest' },
    { id: 'console-log-sensitive', pattern: /console\.log\s*\([^)]*(?:password|secret|token|key)[^)]*\)/i, severity: 'medium', message: '疑似 console.log 输出敏感信息' },
];

function runBuiltinScan(code: string): SecurityScanResult['findings'] {
    const findings: SecurityScanResult['findings'] = [];
    const lines = code.split('\n');

    for (const rule of BUILTIN_RULES) {
        const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
        let match: RegExpExecArray | null;
        const lineNumbers: number[] = [];

        let searchStr = code;
        while ((match = globalPattern.exec(searchStr)) !== null) {
            // Find line number
            const upTo = code.substring(0, match.index);
            const lineNum = upTo.split('\n').length;
            if (!lineNumbers.includes(lineNum)) {
                lineNumbers.push(lineNum);
            }
            if (!globalPattern.flags.includes('g')) break;
        }

        if (lineNumbers.length > 0) {
            findings.push({
                severity: rule.severity,
                rule: rule.id,
                message: rule.message,
                line: lineNumbers[0],
            });
        }
    }

    return findings;
}

function trySemgrep(code: string): SecurityScanResult['findings'] | null {
    const tmpFile = join(tmpdir(), `skill-security-scan-${Date.now()}.ts`);
    try {
        writeFileSync(tmpFile, code, 'utf-8');
        const result = execSync(
            `semgrep --json --config auto ${tmpFile}`,
            { timeout: 30000, encoding: 'utf-8' }
        );
        const parsed = JSON.parse(result);
        const findings: SecurityScanResult['findings'] = [];
        for (const r of parsed.results ?? []) {
            const sev = (r.extra?.severity ?? 'medium').toLowerCase();
            const mapped: RuleSeverity = ['critical', 'high', 'medium', 'low'].includes(sev)
                ? sev as RuleSeverity
                : 'medium';
            findings.push({
                severity: mapped,
                rule: r.check_id ?? 'semgrep',
                message: r.extra?.message ?? r.message ?? 'Semgrep finding',
                line: r.start?.line,
            });
        }
        return findings;
    } catch {
        return null;
    } finally {
        if (existsSync(tmpFile)) {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }
}

export class SecurityScanner {
    async scan(indexTs: string): Promise<SecurityScanResult> {
        let findings: SecurityScanResult['findings'];

        const semgrepFindings = trySemgrep(indexTs);
        if (semgrepFindings !== null) {
            findings = semgrepFindings;
        } else {
            findings = runBuiltinScan(indexTs);
        }

        const hasCriticalOrHigh = findings.some(f => f.severity === 'critical' || f.severity === 'high');

        return {
            passed: !hasCriticalOrHigh,
            findings,
        };
    }
}
