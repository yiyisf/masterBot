/**
 * Loop Engineering 模块出口（U15）
 */

export { LoopRunner } from './loop-runner.js';
export type { LoopRunnerDeps, LoopOutcome, LoopRunResult } from './loop-runner.js';
export { parseLoopSpec, validateLoopSpec } from './loop-spec.js';
export type { LoopSpec, VerifierSpec } from './loop-spec.js';
export { runVerifiers, evaluateAssert } from './verifier.js';
export type { VerifierReport, VerifierResult } from './verifier.js';

import { nanoid } from 'nanoid';
import { LoopRunner } from './loop-runner.js';
import type { LoopSpec } from './loop-spec.js';
import { Grader } from '../harness/grader.js';
import type { AgentPool } from '../harness/agent-pool.js';
import type { ISkillRegistry } from '../../skills/registry.js';
import type { LLMAdapter, Logger, MemoryAccess, SkillContext, ExecutionStep } from '../../types.js';

export interface CreateLoopRunnerOptions {
    agentPool: AgentPool;
    registry: ISkillRegistry;
    getLLM: (provider?: string) => LLMAdapter;
    logger: Logger;
    memory: MemoryAccess;
    sessionId?: string;
    /** 停滞升级回调（默认仅记日志；集成方可桥接 IM 通知 / InterruptCoordinator）*/
    escalate?: (reason: string, spec: LoopSpec) => Promise<void>;
}

/**
 * 生产组装：LoopSpec + 既有原语 → 可执行的 LoopRunner
 * - execute.agent 配置时经 AgentPool（享受 Harness 的权限过滤/Hook/审计）
 * - 验证器经 ISkillRegistry.executeAction（与正常技能调用同一治理通道）
 */
export function createLoopRunner(spec: LoopSpec, opts: CreateLoopRunnerOptions): LoopRunner {
    const sessionId = opts.sessionId ?? `loop-${spec.id}-${nanoid(8)}`;

    const skillContext: SkillContext = {
        sessionId,
        memory: opts.memory,
        logger: opts.logger,
        config: {},
    };

    const runTask = (task: string, _iteration: number): AsyncGenerator<ExecutionStep> => {
        const agentSpecId = spec.execute.agent;
        if (!agentSpecId) {
            throw new Error(`LoopSpec "${spec.id}" 未配置 execute.agent（生产组装需指定 AgentPool spec id）`);
        }
        return (async function* () {
            const instanceId = await opts.agentPool.spawn(agentSpecId, task, {
                sessionId,
                memory: opts.memory,
                trigger: 'scheduled',
            });
            yield* opts.agentPool.streamInstance(instanceId);
        })();
    };

    return new LoopRunner(spec, {
        logger: opts.logger,
        runTask,
        executeTool: (tool, params) => opts.registry.executeAction(tool, params, skillContext),
        grader: spec.grader ? new Grader(opts.getLLM, opts.logger) : undefined,
        escalate: opts.escalate ?? (async (reason) => {
            opts.logger.warn(`[loop:${spec.id}] Escalation (no handler wired): ${reason}`);
        }),
    });
}
