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
            phase TEXT, analysis_spec TEXT, parent_id TEXT, card_no INTEGER,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_key ON requirements(req_key);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_dedup ON requirements(project_id, source, source_key);
        CREATE INDEX IF NOT EXISTS idx_req_parent ON requirements(parent_id, card_no);
        CREATE TABLE IF NOT EXISTS requirement_runs (
            id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, project_id TEXT NOT NULL, engine TEXT NOT NULL,
            worktree_path TEXT, branch TEXT, session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
            retry_no INTEGER NOT NULL DEFAULT 0, pr_url TEXT, error_message TEXT, token_cost TEXT, resume_token TEXT,
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

    // ─────────────────────────── 两阶段自动化：startAnalysis / startImplementation（spec #85）───────────────────────────

    describe('startAnalysis', () => {
        it('建 worktree、建 run，phase=analysis，成功结束后转 analyzed（不是 implemented）', async () => {
            const service = makeService(() => engineYielding([{ type: 'answer', content: 'spec drafted', timestamp: new Date() }]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a1', source: 'github', sourceKey: 'a1', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'queued');

            const { runId } = await service.startAnalysis(requirement.id);
            await new Promise(r => setTimeout(r, 0));

            expect(worktree.ensure).toHaveBeenCalled();
            expect(runs.getById(runId)!.status).toBe('succeeded');
            const updated = requirements.getById(requirement.id)!;
            expect(updated.status).toBe('analyzed');
            expect(updated.phase).toBe('analysis');
        });

        it('拒绝非可分析状态（如 in_progress）', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a2', source: 'github', sourceKey: 'a2', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'in_progress');
            await expect(service.startAnalysis(requirement.id)).rejects.toThrow(/analyzable state/);
        });

        it('interrupt 步骤 → waiting_input，恢复后 → in_progress，最终 analyzed', async () => {
            const service = makeService(() => engineYielding([
                { type: 'interrupt', interruptKind: 'question', interruptId: 'i1', content: 'q?', timestamp: new Date() },
                { type: 'answer', content: 'spec drafted', timestamp: new Date() },
            ]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a3', source: 'github', sourceKey: 'a3', title: 'Add feature',
            });
            await service.startAnalysis(requirement.id);
            await new Promise(r => setTimeout(r, 0));
            expect(requirements.getById(requirement.id)!.status).toBe('analyzed');
        });

        it('reanalyze=false 时 analyzed 状态不可再次 startAnalysis（需显式 reanalyze）', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a4', source: 'github', sourceKey: 'a4', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'analyzed');
            await expect(service.startAnalysis(requirement.id)).rejects.toThrow(/analyzable state/);
        });

        it('reanalyze=true 允许从 analyzed 重新发起，并把尚未 implemented 的卡片标记 cancelled（已实现卡片不受影响）', async () => {
            const service = makeService(() => engineYielding([{ type: 'answer', content: 'redone', timestamp: new Date() }]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a5', source: 'github', sourceKey: 'a5', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'analyzed');
            const doneCard = requirements.createCard({ parentId: requirement.id, projectId, reqKey: 'cmasterBot#a5-1', source: 'manual', sourceKey: 'a5-1', title: '卡1', cardNo: 1 });
            requirements.updateStatus(doneCard.id, 'implemented');
            const pendingCard = requirements.createCard({ parentId: requirement.id, projectId, reqKey: 'cmasterBot#a5-2', source: 'manual', sourceKey: 'a5-2', title: '卡2', cardNo: 2 });

            await service.startAnalysis(requirement.id, { reanalyze: true });
            await new Promise(r => setTimeout(r, 0));

            expect(requirements.getById(doneCard.id)!.status).toBe('implemented'); // 已实现的不受影响
            expect(requirements.getById(pendingCard.id)!.status).toBe('cancelled'); // 未实现的被作废
            expect(requirements.getById(requirement.id)!.status).toBe('analyzed');
        });

        it('reanalyze=true 但需求处于 in_progress/waiting_input/merged/cancelled 时拒绝', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#a6', source: 'github', sourceKey: 'a6', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'merged');
            await expect(service.startAnalysis(requirement.id, { reanalyze: true })).rejects.toThrow(/cannot be reanalyzed/);
        });
    });

    describe('startImplementation', () => {
        function makeAnalyzedWithCards(cardCount: number, reqKeyPrefix: string) {
            const requirement = requirements.create({
                projectId, reqKey: `cmasterBot#${reqKeyPrefix}`, source: 'github', sourceKey: reqKeyPrefix, title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'analyzed');
            const cards = Array.from({ length: cardCount }, (_, i) =>
                requirements.createCard({
                    parentId: requirement.id, projectId, reqKey: `cmasterBot#${reqKeyPrefix}-${i + 1}`,
                    source: 'manual', sourceKey: `${reqKeyPrefix}-${i + 1}`, title: `卡片 ${i + 1}`, cardNo: i + 1,
                }));
            return { requirement, cards };
        }

        it('拒绝非可实现状态（如 synced）', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#i1', source: 'github', sourceKey: 'i1', title: 'Add feature',
            });
            await expect(service.startImplementation(requirement.id)).rejects.toThrow(/implementable state/);
        });

        it('无卡片时拒绝', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#i2', source: 'github', sourceKey: 'i2', title: 'Add feature',
            });
            requirements.updateStatus(requirement.id, 'analyzed');
            await expect(service.startImplementation(requirement.id)).rejects.toThrow(/no cards/);
        });

        it('按 card_no 顺序串行驱动全部卡片，全部完成后父需求转 implemented，共用同一 worktree', async () => {
            const { requirement, cards } = makeAnalyzedWithCards(2, 'i3');
            const service = makeService(() => engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]));

            await service.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));

            expect(requirements.getById(cards[0].id)!.status).toBe('implemented');
            expect(requirements.getById(cards[1].id)!.status).toBe('implemented');
            expect(requirements.getById(requirement.id)!.status).toBe('implemented');
            // ensure 只调用一次（父需求）——卡片共用同一 worktree，不各自新建
            expect(worktree.ensure).toHaveBeenCalledTimes(1);
        });

        it('某卡失败时停在当卡：后续卡片不执行，父需求同步为 failed', async () => {
            const { requirement, cards } = makeAnalyzedWithCards(3, 'i4');
            let call = 0;
            const service = makeService(() => {
                call += 1;
                if (call === 2) return engineThrowing('card 2 boom');
                return engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]);
            });

            await service.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));

            expect(requirements.getById(cards[0].id)!.status).toBe('implemented');
            expect(requirements.getById(cards[1].id)!.status).toBe('failed');
            expect(requirements.getById(cards[2].id)!.status).toBe('queued'); // 未被驱动
            expect(requirements.getById(requirement.id)!.status).toBe('failed');
        });

        it('从失败卡续跑：再次调用 startImplementation 会跳过已 implemented 的卡片，重试失败的那张', async () => {
            const { requirement, cards } = makeAnalyzedWithCards(2, 'i5');
            let firstAttemptCall = 0;
            const service = makeService(() => {
                firstAttemptCall += 1;
                if (firstAttemptCall === 2) return engineThrowing('card 2 boom');
                return engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]);
            });
            await service.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));
            expect(requirements.getById(cards[1].id)!.status).toBe('failed');
            expect(requirements.getById(requirement.id)!.status).toBe('failed');

            // 重试：第二次调用换一个总是成功的引擎
            const retryService = makeService(() => engineYielding([{ type: 'answer', content: 'done on retry', timestamp: new Date() }]));
            await retryService.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));

            expect(requirements.getById(cards[0].id)!.status).toBe('implemented'); // 未被重复驱动，保持原状态
            expect(requirements.getById(cards[1].id)!.status).toBe('implemented');
            expect(requirements.getById(requirement.id)!.status).toBe('implemented');
        });

        it('skipCard() 跳过某张失败卡后续跑，直接推进到下一张，不重试被跳过的卡', async () => {
            const { requirement, cards } = makeAnalyzedWithCards(2, 'i6');
            let call = 0;
            const service = makeService(() => {
                call += 1;
                if (call === 1) return engineThrowing('card 1 boom');
                return engineYielding([{ type: 'answer', content: 'done', timestamp: new Date() }]);
            });
            await service.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));
            expect(requirements.getById(cards[0].id)!.status).toBe('failed');

            service.skipCard(cards[0].id);
            expect(requirements.getById(cards[0].id)!.status).toBe('cancelled');

            await service.startImplementation(requirement.id);
            await new Promise(r => setTimeout(r, 0));

            expect(requirements.getById(cards[0].id)!.status).toBe('cancelled'); // 保持跳过态，不被重试
            expect(requirements.getById(cards[1].id)!.status).toBe('implemented');
            expect(requirements.getById(requirement.id)!.status).toBe('implemented');
        });
    });

    describe('skipCard', () => {
        it('把失败/排队中的卡片标记 cancelled', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#sc1', source: 'github', sourceKey: 'sc1', title: 'Add feature',
            });
            const card = requirements.createCard({ parentId: requirement.id, projectId, reqKey: 'cmasterBot#sc1-1', source: 'manual', sourceKey: 'sc1-1', title: '卡1', cardNo: 1 });

            service.skipCard(card.id);
            expect(requirements.getById(card.id)!.status).toBe('cancelled');
        });

        it('拒绝对非卡片（无 parentId）调用', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#sc2', source: 'github', sourceKey: 'sc2', title: 'Add feature',
            });
            expect(() => service.skipCard(requirement.id)).toThrow(/is not a card/);
        });

        it('拒绝对已终态（implemented/cancelled）卡片调用', async () => {
            const service = makeService(() => engineYielding([]));
            const requirement = requirements.create({
                projectId, reqKey: 'cmasterBot#sc3', source: 'github', sourceKey: 'sc3', title: 'Add feature',
            });
            const card = requirements.createCard({ parentId: requirement.id, projectId, reqKey: 'cmasterBot#sc3-1', source: 'manual', sourceKey: 'sc3-1', title: '卡1', cardNo: 1 });
            requirements.updateStatus(card.id, 'implemented');
            expect(() => service.skipCard(card.id)).toThrow(/already terminal/);
        });
    });
});
