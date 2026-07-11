import { nanoid } from 'nanoid';
import type { Logger, MemoryAccess } from '../types.js';
import { projectRepository, type ProjectRepository, type Project } from './project-repository.js';
import { requirementRepository, type RequirementRepository, type Requirement } from './requirement-repository.js';
import { requirementRunRepository, type RequirementRunRepository, type RequirementRun } from './requirement-run-repository.js';
import { worktreeManager, type WorktreeManager } from './worktree-manager.js';
import { ClaudeAgentSdkEngine } from './harness/claude-sdk-engine.js';
import type { IAgentEngine } from './harness/agent-engine.js';
import { defaultAgentSpec, type AgentSpec } from './harness/agent-spec.js';

/** coding agent 运行不使用 cmasterBot 自身的记忆系统 */
const noopMemory: MemoryAccess = {
    async get() { return undefined; },
    async set() { /* no-op */ },
    async search() { return []; },
};

/** v1 只支持默认 claude-code 引擎；codex/opencode/pi 留给后续 ticket（实施地图 #61 #65/#66） */
const STARTABLE_STATUSES: Requirement['status'][] = ['synced', 'queued', 'failed'];

export interface StartRunOptions {
    approvalMode?: 'auto' | 'ask-on-risky';
}

export interface RequirementExecutionServiceDeps {
    projects?: ProjectRepository;
    requirements?: RequirementRepository;
    runs?: RequirementRunRepository;
    worktree?: WorktreeManager;
    logger?: Logger;
    /** 依赖注入：测试用 fake engine 替换真实 SDK 引擎 */
    createEngine?: (spec: AgentSpec, logger: Logger) => IAgentEngine;
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
    private createEngine: (spec: AgentSpec, logger: Logger) => IAgentEngine;

    constructor(deps: RequirementExecutionServiceDeps = {}) {
        this.projects = deps.projects ?? projectRepository;
        this.requirements = deps.requirements ?? requirementRepository;
        this.runs = deps.runs ?? requirementRunRepository;
        this.worktree = deps.worktree ?? worktreeManager;
        this.logger = deps.logger ?? consoleLogger;
        this.createEngine = deps.createEngine ?? ((spec, logger) => new ClaudeAgentSdkEngine(spec, logger, {}));
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

        const { path: worktreePath, branch } = await this.worktree.ensure(project, requirement);
        const sessionId = nanoid();
        const run = this.runs.create({
            requirementId: requirement.id,
            projectId: project.id,
            engine: 'claude-agent-sdk',
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

    private async drive(
        project: Project,
        requirement: Requirement,
        run: RequirementRun,
        options: StartRunOptions
    ): Promise<void> {
        const spec = defaultAgentSpec({
            id: `dev-workflow-${requirement.id}`,
            name: `研发流程执行 ${requirement.reqKey}`,
            engine: 'claude-agent-sdk',
            systemPrompt: [
                `你正在处理需求 ${requirement.reqKey}：${requirement.title}`,
                requirement.description ?? '',
                '请实现该需求、提交代码并开 PR。若需要澄清需求或做出只有人类才能决定的选择，调用 ask_user 工具向人类提问。',
            ].filter(Boolean).join('\n\n'),
        });
        const engine = this.createEngine(spec, this.logger);
        const task = `实现需求 ${requirement.reqKey}：${requirement.title}`;

        let awaitingResume = false;
        try {
            for await (const step of engine.run(task, {
                sessionId: run.sessionId,
                memory: noopMemory,
                cwd: run.worktreePath ?? undefined,
                approvalMode: options.approvalMode ?? 'auto',
            })) {
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

            this.runs.updateStatus(run.id, 'succeeded', { finished: true });
            this.requirements.updateStatus(requirement.id, 'implemented');
        } catch (err) {
            this.runs.updateStatus(run.id, 'failed', { errorMessage: (err as Error).message, finished: true });
            this.requirements.updateStatus(requirement.id, 'failed');
        }
    }
}

export const requirementExecutionService = new RequirementExecutionService();
