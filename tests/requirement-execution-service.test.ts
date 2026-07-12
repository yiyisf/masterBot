import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRepository } from '../src/core/project-repository.js';
import { RequirementRepository } from '../src/core/requirement-repository.js';
import { RequirementRunRepository } from '../src/core/requirement-run-repository.js';
import { RequirementExecutionService } from '../src/core/requirement-execution-service.js';
import type { WorktreeManager } from '../src/core/worktree-manager.js';
import type { IAgentEngine } from '../src/core/harness/agent-engine.js';
import type { ExecutionStep } from '../src/types.js';
import { sessionEventStore } from '../src/core/harness/session-store.js';
import { nanoid } from 'nanoid';

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

    function makeService(createEngine: (engineKind: any, spec: any, logger: any) => IAgentEngine) {
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

    it('drive(): 把每个 ExecutionStep 写进 session_events（agent_step），供前端执行时间线回放', async () => {
        const service = makeService(() => engineYielding([
            { type: 'content', content: 'working...', timestamp: new Date() },
            { type: 'action', content: '调用 Bash', toolName: 'Bash', toolInput: { command: 'ls' }, timestamp: new Date() },
            { type: 'observation', content: 'file1', timestamp: new Date() },
            { type: 'answer', content: 'done', timestamp: new Date() },
        ]));

        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#events1', source: 'github', sourceKey: 'events1', title: 'Add feature',
        });
        const project = projects.getById(projectId)!;
        const sessionId = `sess-events-${nanoid()}`; // session_events 是真实持久化的表，用随机 id 避免重复跑测试时累积
        const run = runs.create({ requirementId: requirement.id, projectId, engine: 'claude-agent-sdk', sessionId });

        await (service as any).drive(project, requirement, run, {});

        const events = sessionEventStore.getEvents(sessionId);
        expect(events.some(e => e.type === 'session_start')).toBe(true);
        expect(events.some(e => e.type === 'session_end' && (e.payload as any).status === 'succeeded')).toBe(true);

        const stepEvents = events.filter(e => e.type === 'agent_step');
        expect(stepEvents).toHaveLength(4);
        expect(stepEvents.map(e => (e.payload as any).type)).toEqual(['content', 'action', 'observation', 'answer']);
        expect((stepEvents[1].payload as any).toolName).toBe('Bash');
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

    it('start() 默认引擎为 claude-code，run.engine 记为 claude-agent-sdk', async () => {
        const createEngine = vi.fn(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));
        const service = makeService(createEngine);
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#8', source: 'github', sourceKey: '8', title: 'Add feature',
        });
        const { runId } = await service.start(requirement.id);
        expect(createEngine).toHaveBeenCalledWith('claude-code', expect.anything(), expect.anything());
        expect(runs.getById(runId)!.engine).toBe('claude-agent-sdk');
    });

    it('start({ engine: "codex" }) 走 codex 分支，run.engine 记为 codex', async () => {
        const createEngine = vi.fn(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));
        const service = makeService(createEngine);
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#9', source: 'github', sourceKey: '9', title: 'Add feature',
        });
        const { runId } = await service.start(requirement.id, { engine: 'codex' });
        expect(createEngine).toHaveBeenCalledWith('codex', expect.anything(), expect.anything());
        expect(runs.getById(runId)!.engine).toBe('codex');
    });

    it.each(['opencode', 'pi'] as const)('start({ engine: "%s" }) 走对应分支，run.engine 记为 %s', async (engineKind) => {
        const createEngine = vi.fn(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));
        const service = makeService(createEngine);
        const requirement = requirements.create({
            projectId, reqKey: `cmasterBot#${engineKind}`, source: 'github', sourceKey: engineKind, title: 'Add feature',
        });
        const { runId } = await service.start(requirement.id, { engine: engineKind });
        expect(createEngine).toHaveBeenCalledWith(engineKind, expect.anything(), expect.anything());
        expect(runs.getById(runId)!.engine).toBe(engineKind);
    });

    it('retry() 复用 worktree、沿用上次引擎、retry_no 递增，需求从 failed 转回 in_progress→implemented', async () => {
        const createEngine = vi.fn(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));
        const service = makeService(createEngine);
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#r1', source: 'github', sourceKey: 'r1', title: 'Add feature',
        });
        await service.start(requirement.id, { engine: 'codex' });
        await new Promise(r => setTimeout(r, 0));
        expect(requirements.getById(requirement.id)!.status).toBe('implemented');

        // 手动模拟"这次执行失败了"，再重试
        requirements.updateStatus(requirement.id, 'failed');
        createEngine.mockClear();
        const { runId: retryRunId } = await service.retry(requirement.id);
        await new Promise(r => setTimeout(r, 0));

        expect(createEngine).toHaveBeenCalledWith('codex', expect.anything(), expect.anything());
        expect(worktree.ensure).toHaveBeenCalledTimes(2); // start 一次，retry 一次
        const retryRun = runs.getById(retryRunId)!;
        expect(retryRun.retryNo).toBe(1);
        expect(requirements.getById(requirement.id)!.status).toBe('implemented');
    });

    it('retry() 拒绝非 failed 状态', async () => {
        const service = makeService(() => engineYielding([]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#r2', source: 'github', sourceKey: 'r2', title: 'Add feature',
        });
        await expect(service.retry(requirement.id)).rejects.toThrow(/retryable state/);
    });

    it('cancel() 中止运行中的 run：requirement/run 转 cancelled（不是 failed），引擎收到 abortSignal', async () => {
        let sawAbort = false;
        const service = makeService(() => ({
            kind: 'claude-agent-sdk',
            capabilities: { interactiveApproval: true, resume: false },
            run: async function* (_input: string, context: any) {
                yield { type: 'content', content: 'working...', timestamp: new Date() };
                await new Promise<void>((resolve, reject) => {
                    context.abortSignal?.addEventListener('abort', () => {
                        sawAbort = true;
                        reject(new Error('aborted'));
                    }, { once: true });
                });
            },
        }));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#c1', source: 'github', sourceKey: 'c1', title: 'Add feature',
        });
        requirements.updateStatus(requirement.id, 'queued');

        const { runId } = await service.start(requirement.id);
        await new Promise(r => setTimeout(r, 0));
        expect(requirements.getById(requirement.id)!.status).toBe('in_progress');

        await service.cancel(requirement.id);
        await new Promise(r => setTimeout(r, 0));

        expect(sawAbort).toBe(true);
        expect(requirements.getById(requirement.id)!.status).toBe('cancelled');
        expect(runs.getById(runId)!.status).toBe('cancelled');
    });

    it('cancel() 拒绝非活跃状态', async () => {
        const service = makeService(() => engineYielding([]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#c2', source: 'github', sourceKey: 'c2', title: 'Add feature',
        });
        await expect(service.cancel(requirement.id)).rejects.toThrow(/cancellable state/);
    });

    it('merge() 把 implemented 需求标为 merged 并清理 worktree', async () => {
        const service = makeService(() => engineYielding([]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#m1', source: 'github', sourceKey: 'm1', title: 'Add feature',
        });
        requirements.updateStatus(requirement.id, 'implemented');

        await service.merge(requirement.id);

        expect(requirements.getById(requirement.id)!.status).toBe('merged');
        expect(worktree.remove).toHaveBeenCalled();
    });

    it('merge() 拒绝非 implemented 状态', async () => {
        const service = makeService(() => engineYielding([]));
        const requirement = requirements.create({
            projectId, reqKey: 'cmasterBot#m2', source: 'github', sourceKey: 'm2', title: 'Add feature',
        });
        await expect(service.merge(requirement.id)).rejects.toThrow(/mergeable state/);
    });
});
