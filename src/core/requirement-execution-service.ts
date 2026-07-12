import { nanoid } from 'nanoid';
import type { Logger, MemoryAccess } from '../types.js';
import { projectRepository, type ProjectRepository, type Project } from './project-repository.js';
import { requirementRepository, type RequirementRepository, type Requirement } from './requirement-repository.js';
import { requirementRunRepository, type RequirementRunRepository, type RequirementRun } from './requirement-run-repository.js';
import { worktreeManager, type WorktreeManager } from './worktree-manager.js';
import { ClaudeAgentSdkEngine } from './harness/claude-sdk-engine.js';
import { CodexEngine } from './harness/codex-engine.js';
import { OpenCodeEngine } from './harness/opencode-engine.js';
import { PiEngine } from './harness/pi-engine.js';
import type { IAgentEngine } from './harness/agent-engine.js';
import { defaultAgentSpec, type AgentSpec } from './harness/agent-spec.js';
import { cancelInterrupt } from './interrupt-coordinator.js';
import { sessionEventStore } from './harness/session-store.js';

/** coding agent 运行不使用 cmasterBot 自身的记忆系统 */
const noopMemory: MemoryAccess = {
    async get() { return undefined; },
    async set() { /* no-op */ },
    async search() { return []; },
};

export type ExecutionEngineKind = 'claude-code' | 'codex' | 'opencode' | 'pi';

const STARTABLE_STATUSES: Requirement['status'][] = ['synced', 'queued', 'failed'];

/** ExecutionEngineKind → requirement_runs.engine 列存的值（对齐 AgentEngineKind） */
const RUN_ENGINE_LABEL: Record<ExecutionEngineKind, string> = {
    'claude-code': 'claude-agent-sdk',
    codex: 'codex',
    opencode: 'opencode',
    pi: 'pi',
};

/** RUN_ENGINE_LABEL 的反查表，供 retry() 从历史 run 还原出 ExecutionEngineKind */
const ENGINE_KIND_FROM_LABEL: Record<string, ExecutionEngineKind> = {
    'claude-agent-sdk': 'claude-code',
    codex: 'codex',
    opencode: 'opencode',
    pi: 'pi',
};

export interface StartRunOptions {
    /** 默认 claude-code；codex/opencode/pi 均无 interactiveApproval（v1 一次性非交互模式），approvalMode 对其无效 */
    engine?: ExecutionEngineKind;
    approvalMode?: 'auto' | 'ask-on-risky';
}

export interface StartAnalysisOptions extends StartRunOptions {
    /**
     * 显式重新分析（spec: 两阶段自动化 #85）：允许从 analyzed/failed/implemented 状态重新发起分析，
     * 并作废尚未 implemented 的卡片（标记 cancelled，不删除；已实现卡片的代码留在 worktree 不受影响）。
     */
    reanalyze?: boolean;
}

/** 分析/实现阶段进入 startable 判定所允许的父需求状态 */
const ANALYSIS_STARTABLE_STATUSES: Requirement['status'][] = ['synced', 'queued', 'failed'];
/** 显式重新分析允许的状态：不能在执行中途或已合并/取消时重新分析 */
const REANALYZE_BLOCKED_STATUSES: Requirement['status'][] = ['in_progress', 'waiting_input', 'merged', 'cancelled'];
/** 实现阶段可继续（首次进入或从失败续跑）的父需求状态 */
const IMPLEMENTATION_RESUMABLE_STATUSES: Requirement['status'][] = ['analyzed', 'failed'];
/** 卡片被认为"已处理，无需再驱动"的终态（implemented=已完成，cancelled=人工跳过） */
const CARD_TERMINAL_STATUSES: Requirement['status'][] = ['implemented', 'cancelled'];

export interface RequirementExecutionServiceDeps {
    projects?: ProjectRepository;
    requirements?: RequirementRepository;
    runs?: RequirementRunRepository;
    worktree?: WorktreeManager;
    logger?: Logger;
    /** 依赖注入：测试用 fake engine 替换真实引擎 */
    createEngine?: (engineKind: ExecutionEngineKind, spec: AgentSpec, logger: Logger) => IAgentEngine;
}

const consoleLogger: Logger = {
    debug: (...args: unknown[]) => console.debug(...args),
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
};

/**
 * 研发流程管理执行层基座：发起研发编排。
 * WorktreeManager 建 worktree → requirement_runs 建行 → 需求状态转 in_progress →
 * 直接驱动 IAgentEngine.run()（cwd=worktree 路径）→ 消费 ExecutionStep 流：
 * interrupt → waiting_input，恢复 → in_progress，正常结束 → succeeded + implemented，
 * 异常 → failed（spec §5）。
 */
export class RequirementExecutionService {
    private projects: ProjectRepository;
    private requirements: RequirementRepository;
    private runs: RequirementRunRepository;
    private worktree: WorktreeManager;
    private logger: Logger;
    private createEngine: (engineKind: ExecutionEngineKind, spec: AgentSpec, logger: Logger) => IAgentEngine;
    /** 运行中的 run（run.id → 中止句柄），供 cancel() 定位并中止；drive() 结束时自行清理 */
    private activeRuns = new Map<string, { controller: AbortController; cancelled: boolean }>();

    constructor(deps: RequirementExecutionServiceDeps = {}) {
        this.projects = deps.projects ?? projectRepository;
        this.requirements = deps.requirements ?? requirementRepository;
        this.runs = deps.runs ?? requirementRunRepository;
        this.worktree = deps.worktree ?? worktreeManager;
        this.logger = deps.logger ?? consoleLogger;
        this.createEngine = deps.createEngine ?? ((engineKind, spec, logger) => {
            switch (engineKind) {
                case 'codex': return new CodexEngine(logger, {});
                case 'opencode': return new OpenCodeEngine(logger, {});
                case 'pi': return new PiEngine(logger, {});
                default: return new ClaudeAgentSdkEngine(spec, logger, {});
            }
        });
    }

    /**
     * 发起研发：点火即走，不阻塞调用方——执行在后台异步推进，
     * 状态变化通过 requirement/run 的状态字段可查（前端轮询/回放读取）。
     */
    async start(requirementId: string, options: StartRunOptions = {}): Promise<{ runId: string; sessionId: string }> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);
        if (!STARTABLE_STATUSES.includes(requirement.status)) {
            throw new Error(`Requirement is not in a startable state (current: ${requirement.status})`);
        }
        const project = this.projects.getById(requirement.projectId);
        if (!project) throw new Error(`Project not found: ${requirement.projectId}`);

        const engineKind = options.engine ?? 'claude-code';
        const { path: worktreePath, branch } = await this.worktree.ensure(project, requirement);
        const sessionId = nanoid();
        const run = this.runs.create({
            requirementId: requirement.id,
            projectId: project.id,
            engine: RUN_ENGINE_LABEL[engineKind],
            sessionId,
            worktreePath,
            branch,
        });
        this.requirements.updateStatus(requirement.id, 'in_progress');

        this.drive(project, requirement, run, options).catch(err => {
            this.logger.error(`[requirement-execution] run ${run.id} crashed outside drive()'s own try/catch: ${(err as Error).message}`);
        });

        return { runId: run.id, sessionId };
    }

    /**
     * 失败重试：默认复用同一 worktree（保留半成品与错误现场），沿用上次的引擎，
     * retry_no 递增（spec §4.1/§4.4）。
     */
    async retry(requirementId: string, options: StartRunOptions = {}): Promise<{ runId: string; sessionId: string }> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);
        if (requirement.status !== 'failed') {
            throw new Error(`Requirement is not in a retryable state (current: ${requirement.status})`);
        }
        const project = this.projects.getById(requirement.projectId);
        if (!project) throw new Error(`Project not found: ${requirement.projectId}`);

        const [latestRun] = this.runs.listByRequirement(requirementId);
        if (!latestRun) throw new Error(`No previous run found for requirement: ${requirementId}`);

        await this.worktree.ensure(project, requirement); // 复用现场
        const sessionId = nanoid();
        const run = this.runs.incrementRetryFrom(latestRun, sessionId);
        this.requirements.updateStatus(requirement.id, 'in_progress');

        const engineKind = ENGINE_KIND_FROM_LABEL[latestRun.engine] ?? 'claude-code';
        this.drive(project, requirement, run, { ...options, engine: engineKind }).catch(err => {
            this.logger.error(`[requirement-execution] retry run ${run.id} crashed outside drive()'s own try/catch: ${(err as Error).message}`);
        });

        return { runId: run.id, sessionId };
    }

    /**
     * 发起需求分析阶段（spec: 两阶段自动化 #85）：驱动 agent 走 grilling+to-spec 流程理解需求、
     * 必要时提问，成功结束后需求转 analyzed（人工核验点，不是 implemented）。
     * reanalyze=true 时允许从 analyzed/failed/implemented 状态重新发起，并作废尚未 implemented
     * 的卡片（标记 cancelled；已实现卡片的代码留在 worktree，不受影响，不删除）。
     */
    async startAnalysis(requirementId: string, options: StartAnalysisOptions = {}): Promise<{ runId: string; sessionId: string }> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);

        if (options.reanalyze) {
            if (REANALYZE_BLOCKED_STATUSES.includes(requirement.status)) {
                throw new Error(`Requirement cannot be reanalyzed in its current state (current: ${requirement.status})`);
            }
            for (const card of this.requirements.listCardsByParent(requirement.id)) {
                if (!CARD_TERMINAL_STATUSES.includes(card.status)) {
                    this.requirements.updateStatus(card.id, 'cancelled');
                }
            }
        } else if (!ANALYSIS_STARTABLE_STATUSES.includes(requirement.status)) {
            throw new Error(`Requirement is not in an analyzable state (current: ${requirement.status})`);
        }

        const project = this.projects.getById(requirement.projectId);
        if (!project) throw new Error(`Project not found: ${requirement.projectId}`);

        const engineKind = options.engine ?? 'claude-code';
        const { path: worktreePath, branch } = await this.worktree.ensure(project, requirement);
        const sessionId = nanoid();
        const run = this.runs.create({
            requirementId: requirement.id,
            projectId: project.id,
            engine: RUN_ENGINE_LABEL[engineKind],
            sessionId,
            worktreePath,
            branch,
        });
        this.requirements.updatePhase(requirement.id, 'analysis');
        this.requirements.updateStatus(requirement.id, 'in_progress');

        // 调度层 prompt 是薄薄一层：需求上下文 + 强制调用指定 skill 的硬指令（skill 承载真正的
        // 分析流程方法论；平台钉版注入 .agents/skills + 模板细节留给 #89）
        const task = [
            `分析需求 ${requirement.reqKey}：${requirement.title}`,
            requirement.description ?? '',
            '本任务必须先调用 grilling 与 to-spec skill 并遵循其流程完成需求分析；若需要澄清，调用 ask_user 工具向人类提问。',
        ].filter(Boolean).join('\n\n');

        this.executeAgentRun(project, requirement, run, options, { task, phase: 'analysis', onSuccessStatus: 'analyzed' }).catch(err => {
            this.logger.error(`[requirement-execution] analysis run ${run.id} crashed outside its own try/catch: ${(err as Error).message}`);
        });

        return { runId: run.id, sessionId };
    }

    /**
     * 发起（或续跑）拆卡实现阶段（spec: 两阶段自动化 #85）：按 card_no 顺序逐张驱动卡片
     * （子 requirement），共用父需求的 worktree，全部完成后父需求转 implemented（沿用现有
     * 人工核验合并 merge() 流程，统一开一个 PR）。
     *
     * 可重复调用以实现"从失败卡续跑"：每次调用都会跳过已 implemented/cancelled（人工跳过）的
     * 卡片，从第一张未完成的卡片继续——包括上次失败在其上的那张（自然构成重试）。跳过某张卡片
     * 请先调用 skipCard()，再调用本方法继续后续卡片。
     */
    async startImplementation(requirementId: string, options: StartRunOptions = {}): Promise<{ requirementId: string }> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);
        if (!IMPLEMENTATION_RESUMABLE_STATUSES.includes(requirement.status)) {
            throw new Error(`Requirement is not in an implementable state (current: ${requirement.status})`);
        }
        const project = this.projects.getById(requirement.projectId);
        if (!project) throw new Error(`Project not found: ${requirement.projectId}`);

        const cards = this.requirements.listCardsByParent(requirement.id);
        if (cards.length === 0) {
            throw new Error(`Requirement ${requirementId} has no cards to implement`);
        }

        // 共用父需求的 worktree（spec: 共用父 worktree 串行执行卡片，最终一个 PR）
        const { path: worktreePath, branch } = await this.worktree.ensure(project, requirement);
        this.requirements.updatePhase(requirement.id, 'implementation');
        this.requirements.updateStatus(requirement.id, 'in_progress');

        this.driveCardsSequentially(project, requirement, cards, worktreePath, branch, options).catch(err => {
            this.logger.error(`[requirement-execution] implementation for ${requirement.id} crashed outside its own try/catch: ${(err as Error).message}`);
        });

        return { requirementId: requirement.id };
    }

    /**
     * 人工「跳过此卡」：把一张失败/排队中的卡片标记为 cancelled（人工跳过，非引擎产出），
     * 之后调用 startImplementation() 会自然跳过它，继续驱动下一张。
     */
    skipCard(cardId: string): void {
        const card = this.requirements.getById(cardId);
        if (!card) throw new Error(`Card not found: ${cardId}`);
        if (!card.parentId) throw new Error(`Requirement ${cardId} is not a card`);
        if (CARD_TERMINAL_STATUSES.includes(card.status)) {
            throw new Error(`Card is already terminal (current: ${card.status})`);
        }
        this.requirements.updateStatus(cardId, 'cancelled');
    }

    /**
     * 逐张驱动卡片；某卡失败/取消/等待回答则停在当卡（不推进后续卡片），把父需求状态同步为
     * 该卡的终态，供页面据此判断下一步（重试/跳过/回答问题）。全部卡片终态为 implemented 时，
     * 父需求转 implemented（走现有 merge() 流程）。
     */
    private async driveCardsSequentially(
        project: Project,
        parent: Requirement,
        cards: Requirement[],
        worktreePath: string,
        branch: string,
        options: StartRunOptions
    ): Promise<void> {
        for (const card of cards) {
            const currentCard = this.requirements.getById(card.id) ?? card;
            if (CARD_TERMINAL_STATUSES.includes(currentCard.status)) continue; // 已实现或人工跳过

            this.requirements.updateStatus(parent.id, 'in_progress');

            const engineKind = options.engine ?? 'claude-code';
            const sessionId = nanoid();
            const run = this.runs.create({
                requirementId: card.id,
                projectId: project.id,
                engine: RUN_ENGINE_LABEL[engineKind],
                sessionId,
                worktreePath,
                branch,
            });
            this.requirements.updatePhase(card.id, 'implementation');
            this.requirements.updateStatus(card.id, 'in_progress');

            const task = [
                `实现卡片 ${card.reqKey}：${card.title}`,
                card.description ?? '',
                '本任务必须先调用 implement skill 并遵循其流程；若需要澄清或做出只有人类才能决定的选择，调用 ask_user 工具向人类提问。',
            ].filter(Boolean).join('\n\n');

            await this.executeAgentRun(project, card, run, options, { task, phase: 'implementation', onSuccessStatus: 'implemented' });

            const finished = this.requirements.getById(card.id)!;
            if (finished.status !== 'implemented') {
                // 卡片停在 failed/cancelled/waiting_input：父需求同步为同一状态，不推进后续卡片
                this.requirements.updateStatus(parent.id, finished.status);
                return;
            }
        }

        this.requirements.updateStatus(parent.id, 'implemented');
    }

    /**
     * 人工中止执行中的需求：中止引擎（abortSignal）+ 释放挂起的 interrupt（若有）。
     * 找不到内存中的执行现场（如服务重启后的孤儿态，理论上启动扫描已标 failed）时兜底直接改状态。
     */
    async cancel(requirementId: string): Promise<void> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);
        if (requirement.status !== 'in_progress' && requirement.status !== 'waiting_input') {
            throw new Error(`Requirement is not in a cancellable state (current: ${requirement.status})`);
        }
        const [latestRun] = this.runs.listByRequirement(requirementId);
        if (!latestRun) throw new Error(`No run found for requirement: ${requirementId}`);

        const entry = this.activeRuns.get(latestRun.id);
        if (entry) {
            entry.cancelled = true;
            cancelInterrupt(latestRun.sessionId);
            entry.controller.abort();
        } else {
            this.runs.updateStatus(latestRun.id, 'cancelled', { finished: true });
        }
        this.requirements.updateStatus(requirementId, 'cancelled');
    }

    /**
     * 人工核验通过、合并 PR 后调用：标记需求真正完成，自动清理 worktree + 本地分支
     * （spec §4.3）。PR 合并本身在 GitHub 上完成，本方法只记录决定 + 做清理，不代为合并。
     */
    async merge(requirementId: string): Promise<void> {
        const requirement = this.requirements.getById(requirementId);
        if (!requirement) throw new Error(`Requirement not found: ${requirementId}`);
        if (requirement.status !== 'implemented') {
            throw new Error(`Requirement is not in a mergeable state (current: ${requirement.status})`);
        }
        const project = this.projects.getById(requirement.projectId);
        if (!project) throw new Error(`Project not found: ${requirement.projectId}`);

        this.requirements.updateStatus(requirement.id, 'merged');
        try {
            await this.worktree.remove(project, requirement);
        } catch (err) {
            this.logger.warn(`[requirement-execution] cleanup worktree after merge failed (non-fatal): ${(err as Error).message}`);
        }
    }

    /**
     * 旧单阶段 start()/retry() 用的直通入口：语义与改造前完全一致（onSuccessStatus 固定
     * 'implemented'，不触碰 phase 列——旧路径的 phase 永远是 NULL，零迁移成本）。
     */
    private async drive(
        project: Project,
        requirement: Requirement,
        run: RequirementRun,
        options: StartRunOptions
    ): Promise<void> {
        const task = `实现需求 ${requirement.reqKey}：${requirement.title}`;
        const systemPrompt = [
            `你正在处理需求 ${requirement.reqKey}：${requirement.title}`,
            requirement.description ?? '',
            '请实现该需求、提交代码并开 PR。若需要澄清需求或做出只有人类才能决定的选择，调用 ask_user 工具向人类提问。',
        ].filter(Boolean).join('\n\n');

        await this.executeAgentRun(project, requirement, run, options, { task, systemPrompt, onSuccessStatus: 'implemented' });
    }

    /**
     * 两阶段自动化共用的执行核心（spec #85）：驱动一次 IAgentEngine.run()，把 ExecutionStep
     * 流写入 session_events（执行时间线回放），维护 requirement/run 的状态流转——
     * interrupt → waiting_input，恢复 → in_progress，正常结束 → onSuccessStatus，异常 → failed，
     * cancel() 触发 → cancelled。phase 若提供，会在开始驱动前写入 requirements.phase 列
     * （旧单阶段 drive() 不传 phase，保持该列 NULL）。
     */
    private async executeAgentRun(
        project: Project,
        requirement: Requirement,
        run: RequirementRun,
        options: StartRunOptions,
        config: {
            task: string;
            systemPrompt?: string;
            phase?: 'analysis' | 'implementation';
            onSuccessStatus: Requirement['status'];
        }
    ): Promise<void> {
        if (config.phase) this.requirements.updatePhase(requirement.id, config.phase);

        const spec = defaultAgentSpec({
            id: `dev-workflow-${requirement.id}`,
            name: `研发流程执行 ${requirement.reqKey}`,
            engine: 'claude-agent-sdk',
            systemPrompt: config.systemPrompt ?? config.task,
        });
        const engine = this.createEngine(options.engine ?? 'claude-code', spec, this.logger);
        const task = config.task;

        const controller = new AbortController();
        this.activeRuns.set(run.id, { controller, cancelled: false });

        // 执行时间线回放（spec §6.2）：RequirementExecutionService 不走 AgentHarness，
        // 自己把每个 ExecutionStep 写进 session_events，供前端静态回放。
        // best-effort：写入失败不应中断执行。
        const emitEvent = (type: 'session_start' | 'session_end' | 'agent_step', payload: Record<string, unknown>) => {
            try {
                sessionEventStore.append({ sessionId: run.sessionId, timestamp: Date.now(), type, payload });
            } catch { /* non-fatal */ }
        };

        emitEvent('session_start', { specId: spec.id, specName: spec.name, task, requirementId: requirement.id, engine: options.engine ?? 'claude-code' });

        let awaitingResume = false;
        try {
            for await (const step of engine.run(task, {
                sessionId: run.sessionId,
                memory: noopMemory,
                cwd: run.worktreePath ?? undefined,
                approvalMode: options.approvalMode ?? 'auto',
                abortSignal: controller.signal,
            })) {
                emitEvent('agent_step', {
                    type: step.type,
                    content: step.content,
                    toolName: step.toolName,
                    toolInput: step.toolInput,
                    interruptId: step.interruptId,
                    interruptKind: step.interruptKind,
                    interruptReason: step.interruptReason,
                });

                if (step.type === 'interrupt') {
                    awaitingResume = true;
                    this.requirements.updateStatus(requirement.id, 'waiting_input');
                    this.runs.updateStatus(run.id, 'waiting_input');
                    continue;
                }
                if (awaitingResume) {
                    awaitingResume = false;
                    this.requirements.updateStatus(requirement.id, 'in_progress');
                    this.runs.updateStatus(run.id, 'running');
                }
            }

            emitEvent('session_end', { status: 'succeeded' });
            this.runs.updateStatus(run.id, 'succeeded', { finished: true });
            this.requirements.updateStatus(requirement.id, config.onSuccessStatus);
        } catch (err) {
            // cancel() 已经把状态改成 cancelled 了；这里只是让 catch 分支保持终态一致，不覆盖成 failed
            if (this.activeRuns.get(run.id)?.cancelled) {
                emitEvent('session_end', { status: 'cancelled' });
                this.runs.updateStatus(run.id, 'cancelled', { errorMessage: 'Cancelled by user', finished: true });
                this.requirements.updateStatus(requirement.id, 'cancelled');
            } else {
                emitEvent('session_end', { status: 'failed', error: (err as Error).message });
                this.runs.updateStatus(run.id, 'failed', { errorMessage: (err as Error).message, finished: true });
                this.requirements.updateStatus(requirement.id, 'failed');
            }
        } finally {
            this.activeRuns.delete(run.id);
        }
    }
}

export const requirementExecutionService = new RequirementExecutionService();
