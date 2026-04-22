/**
 * agent-run-helpers.ts
 *
 * Agent.run() 内部逻辑拆分（T2-3）：
 * - handleBuiltinToolCall   内置工具执行 async generator
 * - handleExternalToolCalls 外部技能并行执行 async generator
 *
 * 均为纯粹的执行逻辑，不持有 Agent 状态，通过参数注入依赖。
 */

import { nanoid } from 'nanoid';
import type { Message, ExecutionStep, SkillContext, Logger } from '../types.js';
import type { ISkillRegistry } from '../skills/registry.js';
import type { LongTermMemory } from '../memory/long-term.js';
import type { MemoryRouter } from '../memory/memory-router.js';
import type { SessionEventStore, EventSelector } from './harness/session-store.js';
import { taskRepository } from './task-repository.js';
import { DAGExecutor } from './dag-executor.js';
import { waitForApproval } from './interrupt-coordinator.js';
import { spanRecorder } from './trace.js';
import { isDangerousToolCall } from './agent-tools.js';

// ─────────────────────────────────────────────
// Shared context types
// ─────────────────────────────────────────────

export interface BuiltinHandlerDeps {
    logger: Logger;
    longTermMemory?: LongTermMemory;
    memoryRouter?: MemoryRouter;
    sessionStore?: SessionEventStore;
    skillRegistry: ISkillRegistry;
    skillGenerator?: any;
    orchestrator?: any;
    agentPool?: import('./harness/agent-pool.js').AgentPool;
    knowledgeGraph?: any;
    skillConfig: Record<string, unknown>;
    llm: import('../types.js').LLMAdapter;
}

export interface RunContext {
    sessionId: string;
    userId?: string;
    memory: import('../types.js').MemoryAccess;
    abortSignal?: AbortSignal;
    attachments?: import('../types.js').Attachment[];
    traceId: string;
    agentSpanId: string;
}

// ─────────────────────────────────────────────
// Built-in tool handler
// ─────────────────────────────────────────────

/**
 * 处理单个内置工具调用，以 async generator 返回 ExecutionStep。
 * 调用方用 `yield*` 消费，并自行维护 messages 数组。
 *
 * 副作用：向 messages 数组追加对应工具的 { role: 'tool', ... } 结果条目，
 * 以便后续 LLM 调用能看到完整的 tool-result 历史。
 */
export async function* handleBuiltinToolCall(
    toolCall: { id: string; function: { name: string; arguments: string } },
    params: Record<string, unknown>,
    context: RunContext,
    deps: BuiltinHandlerDeps,
    messages: Message[],
): AsyncGenerator<ExecutionStep> {
    const { logger, longTermMemory, memoryRouter, sessionStore, skillRegistry,
        skillGenerator, orchestrator, agentPool, knowledgeGraph, skillConfig, llm } = deps;
    const toolName = toolCall.function.name;

    if (toolName === 'plan_task') {
        const { thought, steps } = params as { thought: string; steps: string[] };
        yield { type: 'thought', content: thought, timestamp: new Date() };
        yield { type: 'plan', content: JSON.stringify(steps), toolName: 'plan_task', toolOutput: steps, timestamp: new Date() };
        messages.push({ role: 'tool', content: `Plan created: ${JSON.stringify(steps)}. Now precede to execute step 1.`, toolCallId: toolCall.id });

    } else if (toolName === 'memory_remember' && longTermMemory) {
        const { content: memContent, category, topic, tags } = params as any;
        const metadata: Record<string, unknown> = {};
        if (category) metadata.category = category;
        if (topic) metadata.topic = topic;
        if (tags) metadata.tags = (tags as string).split(',').map((t: string) => t.trim());
        const memId = await longTermMemory.remember(memContent, metadata, context.sessionId);
        const result = `Memory saved (id: ${memId})`;
        yield { type: 'observation', content: result, toolName, toolOutput: { id: memId }, timestamp: new Date() };
        messages.push({ role: 'tool', content: result, toolCallId: toolCall.id });

    } else if (toolName === 'memory_recall' && longTermMemory) {
        const { query, limit: recallLimit } = params as { query: string; limit?: number };
        let resultStr: string;
        let toolOutput: unknown;
        if (memoryRouter) {
            const unified = await memoryRouter.query(query, { sessionId: context.sessionId, limit: recallLimit ?? 8 });
            toolOutput = unified;
            resultStr = unified.length > 0
                ? unified.map((m: any) => `[${m.source}] ${m.content}`).join('\n')
                : 'No relevant memories found.';
        } else {
            const memories = await longTermMemory.search(query, recallLimit ?? 5);
            toolOutput = memories;
            resultStr = memories.length > 0 ? memories.map(m => `- ${m.content}`).join('\n') : 'No relevant memories found.';
        }
        yield { type: 'observation', content: resultStr, toolName, toolOutput, timestamp: new Date() };
        messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });

    } else if (toolName === 'dag_create_task') {
        const { description: taskDesc, dependencies: deps2 } = params as { description: string; dependencies?: string[] };
        const taskId = taskRepository.createTask(context.sessionId, taskDesc, deps2);
        yield { type: 'task_created', content: `Task created: ${taskDesc}`, taskId, toolName, timestamp: new Date() };
        messages.push({ role: 'tool', content: JSON.stringify({ taskId, description: taskDesc }), toolCallId: toolCall.id });

    } else if (toolName === 'dag_get_status') {
        const dag = taskRepository.getDAG(context.sessionId);
        const resultStr = JSON.stringify(dag, null, 2);
        yield { type: 'observation', content: resultStr, toolName, toolOutput: dag, timestamp: new Date() };
        messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });

    } else if (toolName === 'dag_execute') {
        const skillContext: SkillContext = {
            sessionId: context.sessionId, userId: context.userId,
            memory: context.memory, logger, config: skillConfig,
        };
        const executor = new DAGExecutor(context.sessionId, skillRegistry, skillContext, logger);
        const stepResults: string[] = [];
        for await (const step of executor.execute()) {
            yield { type: step.type, content: step.result || step.error || '', taskId: step.taskId, toolName: 'dag_execute', timestamp: new Date() };
            stepResults.push(`${step.taskId}: ${step.type} - ${step.result || step.error}`);
        }
        const summary = stepResults.length > 0 ? `DAG execution completed:\n${stepResults.join('\n')}` : 'No tasks to execute.';
        messages.push({ role: 'tool', content: summary, toolCallId: toolCall.id });

    } else if (toolName === 'skill_generate' && skillGenerator) {
        const { name, description, actions } = params as any;
        yield { type: 'action', content: `Generating skill: ${name}`, toolName, toolInput: params, timestamp: new Date() };
        try {
            const generated = await skillGenerator.generate({ name, description, actions });
            const dir = await skillGenerator.install(generated);
            try {
                const existingLocal = skillRegistry.getAllSources()
                    .find((s: any) => s.name === 'local-files' && typeof s.loadSkill === 'function') as any;
                if (existingLocal) {
                    await existingLocal.loadSkill(dir);
                    logger.info(`Hot-reloaded skill "${name}" into existing local-files source`);
                } else {
                    const { LocalSkillSource } = await import('../skills/loader.js');
                    const tempSource = new LocalSkillSource([dir], logger);
                    await tempSource.initialize();
                    await skillRegistry.registerSource(tempSource);
                }
            } catch (err) {
                logger.warn(`Hot-reload failed: ${(err as Error).message}`);
            }
            const resultStr = `技能 "${name}" 已生成并安装到 ${dir}。现在可以直接使用它。`;
            yield { type: 'observation', content: resultStr, toolName, timestamp: new Date() };
            messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
        } catch (err: any) {
            const errorMsg = `技能生成失败: ${err.message}`;
            yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
            messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
        }

    } else if (toolName === 'delegate_to_agent') {
        const { worker_id, task } = params as { worker_id: string; task: string; context_summary?: string };
        yield { type: 'action', content: `Delegating to agent: ${worker_id}`, toolName, toolInput: params, timestamp: new Date() };

        const delegateSpanId = spanRecorder.startSpan(context.traceId, context.agentSpanId, `delegate:${worker_id}`, {
            sessionId: context.sessionId, workerId: worker_id,
        });

        try {
            let lastAnswer = '';
            if (agentPool?.getSpec(worker_id)) {
                const childSessionId = `harness-${nanoid(12)}`;
                const instanceId = await agentPool.spawn(worker_id, task, {
                    sessionId: childSessionId,
                    userId: context.userId,
                    memory: context.memory,
                    parentInstanceId: context.traceId,
                    parentSessionId: context.sessionId,
                    trigger: 'chat_delegate',
                });
                yield {
                    type: 'meta' as any,
                    content: `🤖 托管 Agent [${worker_id}] 已启动 (instance: ${instanceId})`,
                    harnessInstanceId: instanceId,
                    delegatedFrom: worker_id,
                    timestamp: new Date(),
                };
                for await (const step of agentPool.streamInstance(instanceId)) {
                    yield { ...step, delegatedFrom: worker_id, harnessInstanceId: instanceId };
                    if (step.type === 'answer') lastAnswer = step.content ?? '';
                }
            } else if (orchestrator) {
                const delegateCtx = { ...context };
                for await (const step of orchestrator.delegateStream(worker_id, task, delegateCtx)) {
                    yield step;
                    if (step.type === 'answer') lastAnswer = step.content ?? '';
                }
            } else {
                throw new Error(`Agent "${worker_id}" not found in AgentPool or Orchestrator`);
            }
            spanRecorder.endSpan(delegateSpanId, lastAnswer.slice(0, 300));
            messages.push({ role: 'tool', content: lastAnswer || '(no answer)', toolCallId: toolCall.id });
        } catch (err: any) {
            spanRecorder.endSpan(delegateSpanId, undefined, err.message);
            const errorMsg = `委托失败: ${err.message}`;
            yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
            messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
        }

    } else if (toolName === 'knowledge_search' && knowledgeGraph) {
        const { query, depth, limit } = params as { query: string; depth?: number; limit?: number };
        try {
            const result = await knowledgeGraph.search(query, { depth: depth ?? 2, limit: limit ?? 10 });
            const nodesSummary = result.nodes.slice(0, 5).map((n: any) =>
                `**${n.title}** (${n.type}): ${n.content.substring(0, 150)}...`
            ).join('\n\n');
            const resultStr = result.nodes.length > 0
                ? `找到 ${result.nodes.length} 个相关知识节点:\n\n${nodesSummary}`
                : '知识库中未找到相关内容。';
            yield { type: 'observation', content: resultStr, toolName, toolOutput: result, timestamp: new Date() };
            messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
        } catch (err: any) {
            const errorMsg = `知识检索失败: ${err.message}`;
            yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
            messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
        }

    } else if (toolName === 'session_recall' && sessionStore) {
        const { types, toolName: filterToolName, last, fromTimestamp, toTimestamp } = params as {
            types?: string[]; toolName?: string; last?: number;
            fromTimestamp?: number; toTimestamp?: number;
        };
        const selector: EventSelector = {
            types: types as any, toolName: filterToolName,
            last: last ?? 20, fromTimestamp, toTimestamp,
        };
        const events = sessionStore.getEvents(context.sessionId, selector);
        const summary = events.length === 0
            ? '当前 session 中未找到匹配的历史事件。'
            : `找到 ${events.length} 条历史事件：\n\n` + events.map(e =>
                `[${new Date(e.timestamp).toISOString()}] ${e.type}: ${JSON.stringify(e.payload).slice(0, 200)}`
              ).join('\n');
        yield { type: 'observation', content: summary, toolName, timestamp: new Date() };
        messages.push({ role: 'tool', content: summary, toolCallId: toolCall.id });
    }
}

// ─────────────────────────────────────────────
// External skill calls handler
// ─────────────────────────────────────────────

/**
 * 并行执行所有外部技能调用，yield 每个 observation。
 */
export async function* handleExternalToolCalls(
    parsedCalls: Array<{
        toolCall: { id: string; function: { name: string; arguments: string } };
        params: Record<string, unknown>;
        toolName: string;
    }>,
    context: RunContext,
    deps: BuiltinHandlerDeps,
    messages: Message[],
): AsyncGenerator<ExecutionStep> {
    const { logger, skillRegistry, skillConfig, llm } = deps;

    // Emit all action steps first
    for (const { toolName, params } of parsedCalls) {
        yield { type: 'action', content: `Calling ${toolName}`, toolName, toolInput: params, timestamp: new Date() };
    }

    // Human-in-the-Loop: check for dangerous tool calls
    const firstDangerous = parsedCalls
        .map(c => ({ ...c, reason: isDangerousToolCall(c.toolName, c.params) }))
        .find(c => c.reason !== null);

    if (firstDangerous) {
        const interruptId = nanoid();
        yield {
            type: 'interrupt',
            interruptId,
            interruptReason: firstDangerous.reason!,
            toolName: firstDangerous.toolName,
            toolInput: firstDangerous.params,
            content: `需要确认：${firstDangerous.reason}`,
            timestamp: new Date(),
        };

        let approved = false;
        try {
            approved = await waitForApproval(context.sessionId, {
                interruptId,
                actionName: firstDangerous.toolName,
                actionParams: JSON.stringify(firstDangerous.params).slice(0, 1000),
                dangerReason: firstDangerous.reason ?? undefined,
            });
        } catch {
            approved = false;
        }

        if (!approved) {
            for (const { toolCall } of parsedCalls) {
                messages.push({ role: 'tool', content: '用户已取消该操作。', toolCallId: toolCall.id });
            }
            yield {
                type: 'observation',
                content: '操作已取消（用户拒绝）。',
                toolName: firstDangerous.toolName,
                timestamp: new Date(),
            };
            return; // 调用方负责 continue 主循环
        }
    }

    const skillContext: SkillContext = {
        sessionId: context.sessionId,
        userId: context.userId,
        memory: context.memory,
        logger,
        config: skillConfig,
        llm,
        sessionToken: (context as any).sessionToken,
    };

    // Phase 21: 为每个外部工具调用开 span
    const toolSpanIds = parsedCalls.map(({ toolName, params: p }) =>
        spanRecorder.startSpan(context.traceId, context.agentSpanId, `tool:${toolName}`, {
            sessionId: context.sessionId,
            input_summary: JSON.stringify(p).slice(0, 200),
        })
    );

    const toolStartTimes = parsedCalls.map(() => Date.now());
    const results = await Promise.allSettled(
        parsedCalls.map(({ toolName, params }) =>
            skillRegistry.executeAction(toolName, params, skillContext)
        )
    );

    for (let i = 0; i < results.length; i++) {
        const { toolCall, toolName } = parsedCalls[i];
        const result = results[i];
        const duration = Date.now() - toolStartTimes[i];

        if (result.status === 'fulfilled') {
            const toolResult = result.value;
            if (toolResult.kind === 'ok') {
                const resultStr = toolResult.value;
                spanRecorder.endSpan(toolSpanIds[i], resultStr.slice(0, 300));

                let parsedOutput: unknown = resultStr;
                try { parsedOutput = JSON.parse(resultStr); } catch { /* keep string */ }

                yield { type: 'observation', content: resultStr, toolName, toolOutput: parsedOutput, duration, timestamp: new Date() };

                // workflow_generated 特殊 step
                if (parsedOutput && typeof parsedOutput === 'object' && (parsedOutput as any).type === 'workflow_generated') {
                    const wf = parsedOutput as any;
                    yield {
                        type: 'workflow_generated', content: resultStr, toolName,
                        workflow: wf.workflow, subWorkflows: wf.subWorkflows,
                        validation: wf.validation, allValid: wf.allValid,
                        explanation: wf.explanation, timestamp: new Date(),
                    } as any;
                }
                messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
            } else {
                const errorMsg = `Error: ${toolResult.message}`;
                spanRecorder.endSpan(toolSpanIds[i], undefined, errorMsg);
                yield { type: 'observation', content: errorMsg, toolName, toolOutput: { error: toolResult.message, retryable: toolResult.retryable }, duration, timestamp: new Date() };
                messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
            }
        } else {
            const errorMsg = `Error: ${result.reason?.message || 'Unknown error'}`;
            spanRecorder.endSpan(toolSpanIds[i], undefined, errorMsg);
            yield { type: 'observation', content: errorMsg, toolName, toolOutput: { error: result.reason?.message }, duration, timestamp: new Date() };
            messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
        }
    }
}
