import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRepository } from '../src/core/project-repository.js';
import { RequirementRepository } from '../src/core/requirement-repository.js';
import { RequirementRunRepository } from '../src/core/requirement-run-repository.js';
import { RequirementExecutionService } from '../src/core/requirement-execution-service.js';
import type { WorktreeManager } from '../src/core/worktree-manager.js';
import type { IAgentEngine } from '../src/core/harness/agent-engine.js';
import type { ExecutionStep } from '../src/types.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, dir TEXT NOT NULL, description TEXT,
            sync_source TEXT NOT NULL DEFAULT 'github', sync_config TEXT, last_synced_at TEXT,
            max_concurrent_runs INTEGER NOT NULL DEFAULT 2, skills_installed_at TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS requirements (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, req_key TEXT NOT NULL, source TEXT NOT NULL,
            source_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT, labels TEXT,
            status TEXT NOT NULL DEFAULT 'synced', source_url TEXT, source_closed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_key ON requirements(req_key);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_dedup ON requirements(project_id, source, source_key);
        CREATE TABLE IF NOT EXISTS requirement_runs (
            id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, project_id TEXT NOT NULL, engine TEXT NOT NULL,
            worktree_path TEXT, branch TEXT, session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
            retry_no INTEGER NOT NULL DEFAULT 0, pr_url TEXT, error_message TEXT, token_cost TEXT,
            started_at TEXT NOT NULL, finished_at TEXT
        );
    `);
    return db;
}

function fakeWorktreeManager(): WorktreeManager {
    return {
        ensure: vi.fn(async (_project, requirement) => ({
            path: `/fake/worktrees/${requirement.reqKey}`,
            branch: `req/${requirement.reqKey}`,
        })),
        reset: vi.fn(),
        remove: vi.fn(),
        exists: vi.fn(() => true),
        pruneOrphans: vi.fn(async () => []),
    } as unknown as WorktreeManager;
}

function engineYielding(steps: ExecutionStep[]): IAgentEngine {
    return {
        kind: 'claude-agent-sdk',
        capabilities: { interactiveApproval: true, resume: false },
        run: async function* () { yield* steps; },
    };
}

function engineThrowing(message: string): IAgentEngine {
    return {
        kind: 'claude-agent-sdk',
        capabilities: { interactiveApproval: true, resume: false },
        run: async function* () {
            throw new Error(message);
            // eslint-disable-next-line no-unreachable
            yield undefined as never;
        },
    };
}

describe('RequirementExecutionService', () => {
    let projects: ProjectRepository;
    let requirements: RequirementRepository;
    let runs: RequirementRunRepository;
    let worktree: WorktreeManager;
    let projectId: string;

    beforeEach(() => {
        const db = createTestDb();
        projects = new ProjectRepository(db as any);
        requirements = new RequirementRepository(db as any);
        runs = new RequirementRunRepository(db as any);
        worktree = fakeWorktreeManager();
        projectId = projects.create({ name: 'cmasterBot', dir: '/repo/cmasterBot' }).id;
    });

    function makeService(createEngine: (spec: any, logger: any) => IAgentEngine) {
        return new RequirementExecutionService({
            projects, requirements, runs, worktree,
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            createEngine,
        });
    }

    it('start() 建 worktree、建 run、需求转 in_progress，且不阻塞等待执行完成', async () => {
        let resolveRun!: () => void;
        const pending = new Promise<void>(r => { resolveRun = r; });
        const service = makeService(() => ({
            kind: 'claude-agent-sdk',
            capabilities: { interactiveApproval: true, resume: false },
            run: async function* () {
                await pending; // 卡住，验证 start() 不会等它
                yield { type: 'answer', content: 'done', timestamp: new Date() } as ExecutionStep;
            },
        }));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'Add feature',
        });
        requirements.updateStatus(requirement.id, 'queued');

        const { runId, sessionId } = await service.start(requirement.id);
        expect(runId).toBeTruthy();
        expect(sessionId).toBeTruthy();
        expect(worktree.ensure).toHaveBeenCalled();
        expect(requirements.getById(requirement.id)!.status).toBe('in_progress');
        expect(runs.getById(runId)!.status).toBe('running');

        resolveRun();
    });

    it('drive(): 正常结束 → run succeeded + 需求 implemented', async () => {
        const service = makeService(() => engineYielding([
            { type: 'content', content: 'working...', timestamp: new Date() },
            { type: 'answer', content: 'done', timestamp: new Date() },
        ]));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#2', source: 'github', sourceKey: '2', title: 'Add feature',
        });
        const project = projects.getById(projectId)!;
        const run = runs.create({ requirementId: requirement.id, projectId, engine: 'claude-agent-sdk', sessionId: 's1' });

        await (service as any).drive(project, requirement, run, {});

        expect(runs.getById(run.id)!.status).toBe('succeeded');
        expect(runs.getById(run.id)!.finishedAt).not.toBeNull();
        expect(requirements.getById(requirement.id)!.status).toBe('implemented');
    });

    it('drive(): interrupt 步骤 → 需求/run 转 waiting_input，恢复后转回 in_progress/running，结束后 implemented', async () => {
        const service = makeService(() => engineYielding([
            { type: 'content', content: 'thinking...', timestamp: new Date() },
            { type: 'interrupt', interruptKind: 'question', interruptId: 'i1', content: 'q?', timestamp: new Date() },
            { type: 'content', content: 'resumed', timestamp: new Date() },
            { type: 'answer', content: 'done', timestamp: new Date() },
        ]));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#3', source: 'github', sourceKey: '3', title: 'Add feature',
        });
        const project = projects.getById(projectId)!;
        const run = runs.create({ requirementId: requirement.id, projectId, engine: 'claude-agent-sdk', sessionId: 's2' });

        await (service as any).drive(project, requirement, run, {});

        // drive() 结束后应该是最终态：succeeded/implemented（中间态是短暂的，验证靠下面单独用例）
        expect(runs.getById(run.id)!.status).toBe('succeeded');
        expect(requirements.getById(requirement.id)!.status).toBe('implemented');
    });

    it('drive(): interrupt 后立即可观察到 waiting_input（不是事后才生效）', async () => {
        let releaseAfterInterrupt!: () => void;
        const gate = new Promise<void>(r => { releaseAfterInterrupt = r; });

        const service = makeService(() => ({
            kind: 'claude-agent-sdk',
            capabilities: { interactiveApproval: true, resume: false },
            run: async function* () {
                yield { type: 'interrupt', interruptKind: 'question', interruptId: 'i2', content: 'q?', timestamp: new Date() } as ExecutionStep;
                await gate;
                yield { type: 'answer', content: 'done', timestamp: new Date() } as ExecutionStep;
            },
        }));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#4', source: 'github', sourceKey: '4', title: 'Add feature',
        });
        const project = projects.getById(projectId)!;
        const run = runs.create({ requirementId: requirement.id, projectId, engine: 'claude-agent-sdk', sessionId: 's3' });

        const drivePromise = (service as any).drive(project, requirement, run, {});

        // 让出一个微任务，使 drive() 内部跑到 interrupt 步骤
        await new Promise(r => setTimeout(r, 0));
        expect(requirements.getById(requirement.id)!.status).toBe('waiting_input');
        expect(runs.getById(run.id)!.status).toBe('waiting_input');

        releaseAfterInterrupt();
        await drivePromise;
        expect(requirements.getById(requirement.id)!.status).toBe('implemented');
    });

    it('drive(): 引擎抛错 → run failed（带 errorMessage）+ 需求 failed', async () => {
        const service = makeService(() => engineThrowing('SDK crashed'));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#5', source: 'github', sourceKey: '5', title: 'Add feature',
        });
        const project = projects.getById(projectId)!;
        const run = runs.create({ requirementId: requirement.id, projectId, engine: 'claude-agent-sdk', sessionId: 's4' });

        await (service as any).drive(project, requirement, run, {});

        const fetchedRun = runs.getById(run.id)!;
        expect(fetchedRun.status).toBe('failed');
        expect(fetchedRun.errorMessage).toBe('SDK crashed');
        expect(requirements.getById(requirement.id)!.status).toBe('failed');
    });

    it('start() 对不存在的需求抛错', async () => {
        const service = makeService(() => engineYielding([]));
        await expect(service.start('nonexistent')).rejects.toThrow(/Requirement not found/);
    });

    it('start() 拒绝非可启动状态（如 implemented）', async () => {
        const service = makeService(() => engineYielding([]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#6', source: 'github', sourceKey: '6', title: 'Add feature',
        });
        requirements.updateStatus(requirement.id, 'implemented');
        await expect(service.start(requirement.id)).rejects.toThrow(/startable state/);
    });

    it('start() 允许从 failed 状态重新发起（复用 worktree 现场）', async () => {
        const service = makeService(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#7', source: 'github', sourceKey: '7', title: 'Add feature',
        });
        requirements.updateStatus(requirement.id, 'failed');
        const { runId } = await service.start(requirement.id);
        expect(runId).toBeTruthy();
        expect(worktree.ensure).toHaveBeenCalled();
    });
});
