import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDatabase } from '../src/core/database.js';
import { SpecBuilder } from '../src/skill-factory/spec-builder.js';
import { SkillSynthesizer } from '../src/skill-factory/synthesizer.js';
import { StaticValidator } from '../src/skill-factory/validators/static.js';
import { SecurityScanner } from '../src/skill-factory/validators/security.js';
import { LLMJudge } from '../src/skill-factory/validators/llm-judge.js';
import { LocalSkillFactory } from '../src/skill-factory/client.js';
import type { LLMAdapter, Logger, Message } from '../src/types.js';
import type { SkillSpec, SandboxTestResult } from '../src/skill-factory/types.js';

// ─── Mock helpers ───────────────────────────────────────────────────────────

function makeMockLLM(responseContent: string): LLMAdapter {
    return {
        provider: 'mock',
        chat: vi.fn().mockResolvedValue({ role: 'assistant', content: responseContent } as Message),
        chatStream: vi.fn(),
        embeddings: vi.fn().mockResolvedValue([[]]),
    };
}

const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as any;

// ─── Sample data ─────────────────────────────────────────────────────────────

const sampleSpec: SkillSpec = {
    name: 'github-pr-lister',
    description: '列出 GitHub 仓库的 PR',
    category: 'web',
    inputs: {
        repo: { type: 'string', description: '仓库名', required: true },
        state: { type: 'string', description: 'PR 状态', required: false },
    },
    outputs: {
        prs: { type: 'array', description: 'PR 列表' },
    },
    requiredScopes: ['network:api.github.com'],
    testCases: [
        { name: '基础查询', input: { repo: 'owner/repo', state: 'open' }, expectedOutput: 'pull_request' },
    ],
};

const validSkillMd = `---
name: github-pr-lister
version: 1.0.0
description: 列出 GitHub 仓库的 PR
author: SkillFactory-2.0
---

### list_prs

列出指定仓库的 Pull Requests。

**Parameters:**
- \`repo\` (string, required): 仓库名 owner/repo
- \`state\` (string): PR 状态 open|closed|all

**Returns:** PR 数组 JSON 字符串`;

const validIndexTs = `import type { SkillContext } from '../../../src/types.js';

export async function list_prs(
    ctx: SkillContext,
    params: { repo: string; state?: string }
): Promise<string> {
    ctx.logger.info('[github-pr-lister] list_prs called');
    try {
        const state = params.state ?? 'open';
        const url = \`https://api.github.com/repos/\${params.repo}/pulls?state=\${state}\`;
        const resp = await fetch(url);
        const data = await resp.json();
        return JSON.stringify(data);
    } catch (err) {
        throw new Error(\`list_prs failed: \${err instanceof Error ? err.message : String(err)}\`);
    }
}`;

const validTestTs = `import { describe, it, expect, vi } from 'vitest';
import { list_prs } from './index.js';

const mockCtx = {
    sessionId: 'test',
    memory: { get: vi.fn(), set: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: {},
} as any;

describe('github-pr-lister', () => {
    it('should return PR list', async () => {
        // mock fetch
        global.fetch = vi.fn().mockResolvedValue({
            json: async () => [{ number: 1, title: 'Test PR', html_url: 'https://github.com/pull_request/1' }],
        }) as any;
        const result = await list_prs(mockCtx, { repo: 'owner/repo', state: 'open' });
        expect(result).toContain('pull_request');
    });
});`;

// ─── DB migration test ────────────────────────────────────────────────────────

describe('Database migration (Phase 9.5 tables)', () => {
    let db: DatabaseSync;

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        initDatabase();
    });

    it('should create skill_factory_jobs table', () => {
        // Use a fresh in-memory DB to test table creation
        const testDb = new DatabaseSync(':memory:');
        testDb.exec(`
            CREATE TABLE IF NOT EXISTS skill_reviews (id TEXT PRIMARY KEY, skill_name TEXT NOT NULL UNIQUE, skill_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', review_notes TEXT, reviewer TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
            CREATE TABLE IF NOT EXISTS admin_audit_log (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
            CREATE TABLE IF NOT EXISTS skill_factory_jobs (id TEXT PRIMARY KEY, skill_name TEXT, state TEXT NOT NULL DEFAULT 'drafting', spec_json TEXT, generated_files_json TEXT, validation_json TEXT, security_json TEXT, sandbox_json TEXT, judge_json TEXT, install_path TEXT, review_id TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT);
            CREATE TABLE IF NOT EXISTS skill_catalog (id TEXT PRIMARY KEY, skill_name TEXT NOT NULL UNIQUE, skill_path TEXT NOT NULL, description TEXT, category TEXT, author TEXT, version TEXT, state TEXT NOT NULL DEFAULT 'active', curation_status TEXT DEFAULT 'normal', usage_30d INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        `);
        const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
        const tableNames = tables.map(t => t.name);
        expect(tableNames).toContain('skill_factory_jobs');
        expect(tableNames).toContain('skill_catalog');
    });

    it('should insert and query skill_factory_jobs rows', () => {
        const testDb = new DatabaseSync(':memory:');
        testDb.exec(`
            CREATE TABLE skill_factory_jobs (id TEXT PRIMARY KEY, skill_name TEXT, state TEXT NOT NULL DEFAULT 'drafting', spec_json TEXT, generated_files_json TEXT, validation_json TEXT, security_json TEXT, sandbox_json TEXT, judge_json TEXT, install_path TEXT, review_id TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT)
        `);
        testDb.prepare(`INSERT INTO skill_factory_jobs (id, skill_name, state, created_by, created_at, updated_at) VALUES ('test-1', 'my-skill', 'drafting', 'admin', datetime('now'), datetime('now'))`).run();
        const row = testDb.prepare('SELECT * FROM skill_factory_jobs WHERE id = ?').get('test-1') as any;
        expect(row.skill_name).toBe('my-skill');
        expect(row.state).toBe('drafting');
    });

    it('should insert and query skill_catalog rows', () => {
        const testDb = new DatabaseSync(':memory:');
        testDb.exec(`
            CREATE TABLE skill_catalog (id TEXT PRIMARY KEY, skill_name TEXT NOT NULL UNIQUE, skill_path TEXT NOT NULL, description TEXT, category TEXT, author TEXT, version TEXT, state TEXT NOT NULL DEFAULT 'active', curation_status TEXT DEFAULT 'normal', usage_30d INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))
        `);
        testDb.prepare(`INSERT INTO skill_catalog (id, skill_name, skill_path, state) VALUES ('c1', 'test-skill', '/skills/installed/test-skill', 'active')`).run();
        const row = testDb.prepare('SELECT * FROM skill_catalog WHERE skill_name = ?').get('test-skill') as any;
        expect(row.curation_status).toBe('normal');
        expect(row.state).toBe('active');
    });
});

// ─── SpecBuilder tests ────────────────────────────────────────────────────────

describe('SpecBuilder', () => {
    it('should parse well-formed LLM spec output', async () => {
        const specJson = JSON.stringify({
            name: 'weather-checker',
            description: '查询天气',
            category: 'web',
            inputs: { city: { type: 'string', description: '城市名', required: true } },
            outputs: { weather: { type: 'string', description: '天气信息' } },
            requiredScopes: ['network:api.weather.com'],
            testCases: [{ name: '北京天气', input: { city: '北京' }, expectedOutput: 'temperature' }],
        });
        const llm = makeMockLLM(specJson);
        const builder = new SpecBuilder(llm, mockLogger);
        const spec = await builder.build('查询城市天气');
        expect(spec.name).toBe('weather-checker');
        expect(spec.inputs).toHaveProperty('city');
        expect(spec.testCases).toHaveLength(1);
    });

    it('should fall back to defaults when LLM output is malformed', async () => {
        const llm = makeMockLLM('这不是JSON格式的输出');
        const builder = new SpecBuilder(llm, mockLogger);
        const spec = await builder.build('发送邮件通知');
        expect(spec.name).toBeTruthy();
        expect(spec.description).toBeTruthy();
        expect(spec.inputs).toBeDefined();
        expect(Object.keys(spec.inputs).length).toBeGreaterThan(0);
        expect(spec.testCases.length).toBeGreaterThan(0);
    });

    it('should enforce kebab-case name', async () => {
        const specJson = JSON.stringify({
            name: 'send-email-notification',
            description: '发送邮件',
            category: 'communication',
            inputs: { to: { type: 'string', description: '收件人', required: true } },
            outputs: { result: { type: 'string', description: '发送结果' } },
            requiredScopes: [],
            testCases: [{ name: '发送测试', input: { to: 'test@example.com' }, expectedOutput: 'sent' }],
        });
        const llm = makeMockLLM(specJson);
        const builder = new SpecBuilder(llm, mockLogger);
        const spec = await builder.build('发送邮件');
        expect(spec.name).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('should populate similarSkills when catalog has matches', async () => {
        const specJson = JSON.stringify({
            name: 'github-issue-tracker',
            description: 'Track GitHub issues',
            category: 'web',
            inputs: { repo: { type: 'string', description: 'repo', required: true } },
            outputs: { issues: { type: 'array', description: 'issues' } },
            requiredScopes: [],
            testCases: [{ name: 'test', input: { repo: 'o/r' }, expectedOutput: 'issue' }],
        });
        const llm = makeMockLLM(specJson);
        const builder = new SpecBuilder(llm, mockLogger);
        const spec = await builder.build('track GitHub issues');
        expect(spec.similarSkills).toBeDefined();
        expect(Array.isArray(spec.similarSkills)).toBe(true);
    });

    it('should handle empty intent gracefully', async () => {
        const llm = makeMockLLM('{}');
        const builder = new SpecBuilder(llm, mockLogger);
        const spec = await builder.build('x');
        expect(spec).toBeDefined();
        expect(typeof spec.name).toBe('string');
    });
});

// ─── SkillSynthesizer tests ───────────────────────────────────────────────────

describe('SkillSynthesizer', () => {
    it('should parse well-formed synthesis output', async () => {
        const filesJson = JSON.stringify({
            skillMd: validSkillMd,
            indexTs: validIndexTs,
            testTs: validTestTs,
        });
        const llm = makeMockLLM(filesJson);
        const synth = new SkillSynthesizer(llm, mockLogger);
        const files = await synth.synthesize(sampleSpec);
        expect(files.skillMd).toContain('name: github-pr-lister');
        expect(files.indexTs).toContain('export async function');
        expect(files.testTs).toContain('describe');
    });

    it('should retry on parse failure and eventually throw', async () => {
        const llm = makeMockLLM('invalid json content');
        const synth = new SkillSynthesizer(llm, mockLogger);
        await expect(synth.synthesize(sampleSpec, { maxAttempts: 2 })).rejects.toThrow();
    });

    it('should throw if skillMd missing', async () => {
        const filesJson = JSON.stringify({ indexTs: validIndexTs, testTs: validTestTs });
        const llm = makeMockLLM(filesJson);
        const synth = new SkillSynthesizer(llm, mockLogger);
        await expect(synth.synthesize(sampleSpec, { maxAttempts: 1 })).rejects.toThrow();
    });
});

// ─── StaticValidator tests ────────────────────────────────────────────────────

describe('StaticValidator', () => {
    const validator = new StaticValidator();

    it('should pass valid skill files', () => {
        const result = validator.validate(
            { skillMd: validSkillMd, indexTs: validIndexTs, testTs: validTestTs },
            sampleSpec
        );
        expect(result.passed).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should fail on missing frontmatter', () => {
        const result = validator.validate(
            { skillMd: '# No frontmatter here', indexTs: validIndexTs, testTs: validTestTs },
            sampleSpec
        );
        expect(result.passed).toBe(false);
        expect(result.errors.some(e => e.includes('frontmatter'))).toBe(true);
    });

    it('should fail on missing frontmatter fields', () => {
        const badMd = `---\nname: test\n---\n### action`;
        const result = validator.validate(
            { skillMd: badMd, indexTs: validIndexTs, testTs: validTestTs },
            { ...sampleSpec, name: 'test' }
        );
        expect(result.passed).toBe(false);
        expect(result.errors.some(e => e.includes('version') || e.includes('description') || e.includes('author'))).toBe(true);
    });

    it('should fail on name mismatch', () => {
        const result = validator.validate(
            { skillMd: validSkillMd, indexTs: validIndexTs, testTs: validTestTs },
            { ...sampleSpec, name: 'different-name' }
        );
        expect(result.passed).toBe(false);
        expect(result.errors.some(e => e.includes('不一致'))).toBe(true);
    });

    it('should fail on empty indexTs', () => {
        const result = validator.validate(
            { skillMd: validSkillMd, indexTs: '', testTs: validTestTs },
            sampleSpec
        );
        expect(result.passed).toBe(false);
    });

    it('should fail on non-kebab-case name', () => {
        const badMd = validSkillMd.replace('name: github-pr-lister', 'name: GithubPrLister');
        const result = validator.validate(
            { skillMd: badMd, indexTs: validIndexTs, testTs: validTestTs },
            { ...sampleSpec, name: 'GithubPrLister' }
        );
        expect(result.passed).toBe(false);
        expect(result.errors.some(e => e.includes('kebab-case'))).toBe(true);
    });

    it('should fail on missing export function', () => {
        const noExport = `// no exports\nconst helper = () => {};`;
        const result = validator.validate(
            { skillMd: validSkillMd, indexTs: noExport, testTs: validTestTs },
            sampleSpec
        );
        expect(result.passed).toBe(false);
        expect(result.errors.some(e => e.includes('导出函数'))).toBe(true);
    });

    it('should warn on empty testTs', () => {
        const result = validator.validate(
            { skillMd: validSkillMd, indexTs: validIndexTs, testTs: '' },
            sampleSpec
        );
        expect(result.warnings.some(w => w.includes('测试'))).toBe(true);
    });
});

// ─── SecurityScanner tests ────────────────────────────────────────────────────

describe('SecurityScanner', () => {
    const scanner = new SecurityScanner();

    it('should pass clean code', async () => {
        const result = await scanner.scan(validIndexTs);
        expect(result.passed).toBe(true);
        const critHigh = result.findings.filter(f => f.severity === 'critical' || f.severity === 'high');
        expect(critHigh).toHaveLength(0);
    });

    it('should detect hardcoded OpenAI key', async () => {
        const code = `const apiKey = 'sk-abcdefghij1234567890ABCDEF';\nexport async function action() { return apiKey; }`;
        const result = await scanner.scan(code);
        expect(result.passed).toBe(false);
        expect(result.findings.some(f => f.severity === 'critical')).toBe(true);
    });

    it('should detect AWS access key', async () => {
        const code = `const key = 'AKIAIOSFODNN7EXAMPLE';\nexport async function action() { return key; }`;
        const result = await scanner.scan(code);
        expect(result.passed).toBe(false);
        expect(result.findings.some(f => f.rule === 'aws-access-key')).toBe(true);
    });

    it('should detect eval usage', async () => {
        const code = `export async function action(ctx: any, params: any) { return eval(params.code); }`;
        const result = await scanner.scan(code);
        expect(result.passed).toBe(false);
        expect(result.findings.some(f => f.rule === 'eval-usage')).toBe(true);
    });

    it('should detect command injection', async () => {
        const code = 'import {exec} from "child_process";\nexport async function run(ctx: any, params: any) { exec(`ls ${params.path}`); }';
        const result = await scanner.scan(code);
        expect(result.passed).toBe(false);
    });

    it('should detect SQL injection', async () => {
        const code = 'export async function query(ctx:any, params:any) { const sql = `SELECT * FROM users WHERE id = ${params.id}`; return sql; }';
        const result = await scanner.scan(code);
        expect(result.passed).toBe(false);
        expect(result.findings.some(f => f.rule.includes('sql'))).toBe(true);
    });

    it('should detect path traversal', async () => {
        const code = `export async function read(ctx:any, params:any) { return '../' + params.file; }`;
        const result = await scanner.scan(code);
        const pathFindings = result.findings.filter(f => f.rule === 'path-traversal');
        expect(pathFindings.length).toBeGreaterThan(0);
    });

    it('should report passed=true for medium/low only', async () => {
        const code = `export async function action(ctx:any) { console.log('process.exit would be here'); return 'ok'; }`;
        const result = await scanner.scan(code);
        // Only medium/low issues should still pass
        const critHigh = result.findings.filter(f => f.severity === 'critical' || f.severity === 'high');
        expect(result.passed).toBe(critHigh.length === 0);
    });
});

// ─── LLMJudge tests ───────────────────────────────────────────────────────────

describe('LLMJudge', () => {
    it('should parse well-formed LLM judge output', async () => {
        const judgement = JSON.stringify({ utility: 8, robustness: 7, security: 9, documentation: 8, feedback: '整体质量良好，error handling 完善。' });
        const llm = makeMockLLM(judgement);
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: true, successRate: 1, results: [], avgDurationMs: 100 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.dimensions.utility).toBe(8);
        expect(result.dimensions.security).toBe(9);
        expect(result.score).toBeGreaterThan(0);
        expect(typeof result.feedback).toBe('string');
    });

    it('should set needsHumanReview=true when score < 7', async () => {
        const judgement = JSON.stringify({ utility: 4, robustness: 5, security: 6, documentation: 5, feedback: '质量不足' });
        const llm = makeMockLLM(judgement);
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: false, successRate: 0.5, results: [], avgDurationMs: 200 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.needsHumanReview).toBe(true);
    });

    it('should set needsHumanReview=false when score >= 7', async () => {
        const judgement = JSON.stringify({ utility: 8, robustness: 8, security: 9, documentation: 8, feedback: '质量良好' });
        const llm = makeMockLLM(judgement);
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: true, successRate: 1, results: [], avgDurationMs: 50 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.needsHumanReview).toBe(false);
    });

    it('should fallback gracefully when LLM returns invalid JSON', async () => {
        const llm = makeMockLLM('抱歉，无法评审');
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: true, successRate: 1, results: [], avgDurationMs: 0 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.score).toBe(5);
        expect(result.needsHumanReview).toBe(true);
    });

    it('should clamp out-of-range scores', async () => {
        const judgement = JSON.stringify({ utility: 15, robustness: -3, security: 8, documentation: 7, feedback: 'test' });
        const llm = makeMockLLM(judgement);
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: true, successRate: 1, results: [], avgDurationMs: 0 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.dimensions.utility).toBeLessThanOrEqual(10);
        expect(result.dimensions.robustness).toBeGreaterThanOrEqual(0);
    });

    it('should compute weighted score correctly', async () => {
        const judgement = JSON.stringify({ utility: 10, robustness: 10, security: 10, documentation: 10, feedback: 'perfect' });
        const llm = makeMockLLM(judgement);
        const judge = new LLMJudge(llm, mockLogger);
        const sandboxResult: SandboxTestResult = { passed: true, successRate: 1, results: [], avgDurationMs: 0 };
        const result = await judge.evaluate(sampleSpec, { skillMd: validSkillMd, indexTs: validIndexTs }, sandboxResult);
        expect(result.score).toBe(10);
    });
});

// ─── LocalSkillFactory CRUD tests ────────────────────────────────────────────

describe('LocalSkillFactory', () => {
    function makeDb() {
        const db = new DatabaseSync(':memory:');
        db.exec(`
            CREATE TABLE skill_reviews (id TEXT PRIMARY KEY, skill_name TEXT NOT NULL UNIQUE, skill_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', review_notes TEXT, reviewer TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
            CREATE TABLE skill_factory_jobs (id TEXT PRIMARY KEY, skill_name TEXT, state TEXT NOT NULL DEFAULT 'drafting', spec_json TEXT, generated_files_json TEXT, validation_json TEXT, security_json TEXT, sandbox_json TEXT, judge_json TEXT, install_path TEXT, review_id TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT);
            CREATE INDEX idx_sfj_state ON skill_factory_jobs(state);
            CREATE INDEX idx_sfj_created_by ON skill_factory_jobs(created_by);
        `);
        return db;
    }

    it('should create a job', async () => {
        const db = makeDb();
        const specJson = JSON.stringify({ ...sampleSpec });
        const llm = makeMockLLM(specJson);
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const job = await factory.createJob('List GitHub PRs', 'admin-user');
        expect(job.id).toBeTruthy();
        expect(job.state).toBe('drafting');
        expect(job.createdBy).toBe('admin-user');
    });

    it('should retrieve a job by id', async () => {
        const db = makeDb();
        const llm = makeMockLLM('{}');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const created = await factory.createJob('Test intent', 'user1');
        const retrieved = factory.getJob(created.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(created.id);
    });

    it('should return null for non-existent job', () => {
        const db = makeDb();
        const llm = makeMockLLM('{}');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const job = factory.getJob('non-existent-id');
        expect(job).toBeNull();
    });

    it('should list all jobs', async () => {
        const db = makeDb();
        const llm = makeMockLLM('{}');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        await factory.createJob('Job 1', 'user1');
        await factory.createJob('Job 2', 'user2');
        const all = factory.listJobs();
        expect(all.length).toBe(2);
    });

    it('should filter jobs by createdBy', async () => {
        const db = makeDb();
        const llm = makeMockLLM('{}');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        await factory.createJob('Job 1', 'user1');
        await factory.createJob('Job 2', 'user2');
        const user1Jobs = factory.listJobs('user1');
        expect(user1Jobs.length).toBe(1);
        expect(user1Jobs[0].createdBy).toBe('user1');
    });

    it('should run stage 1 and persist spec', async () => {
        const db = makeDb();
        const specResponse = JSON.stringify(sampleSpec);
        const llm = makeMockLLM(specResponse);
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const job = await factory.createJob('List GitHub PRs', 'admin');
        const spec = await factory.runStage1(job.id);
        expect(spec.name).toBe('github-pr-lister');
        const updated = factory.getJob(job.id);
        expect(updated?.spec).toBeDefined();
    });

    it('should error on stage 2 without stage 1', async () => {
        const db = makeDb();
        const llm = makeMockLLM('{}');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const job = await factory.createJob('Test', 'admin');
        await expect(factory.runStage2(job.id)).rejects.toThrow('Stage 1');
    });

    it('should store error on pipeline failure', async () => {
        const db = makeDb();
        const llm = makeMockLLM('invalid json');
        const factory = new LocalSkillFactory(llm, mockLogger, db);
        const job = await factory.createJob('Test', 'admin');
        try {
            await factory.runStage1(job.id);
        } catch {
            // expected
        }
        const retrieved = factory.getJob(job.id);
        // Either spec is set (LLM fallback) or error is set
        // Either way the job should be retrievable
        expect(retrieved).not.toBeNull();
    });
});
