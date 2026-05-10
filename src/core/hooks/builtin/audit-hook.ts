/**
 * Task 5f: Audit Hook
 * SessionStart/SessionEnd 时创建/结束 execution_records；
 * PostToolUse / PostToolUseFailure 时记录工具执行摘要。
 */

import type {
    SessionStartEvent,
    SessionEndEvent,
    PostToolUseEvent,
    PostToolUseFailureEvent,
    HookResult,
} from '../types.js';
import { auditRepository } from '../../audit-repository.js';

/** 每个 sessionId 对应的 audit execution ID */
const sessionAuditIds = new Map<string, string>();

export async function auditSessionStartHook(event: SessionStartEvent): Promise<HookResult | void> {
    const execId = auditRepository.createExecution({
        type: 'agent',
        name: `agent:${event.ctx.sessionId}`,
        sessionId: event.ctx.sessionId,
        triggerSource: 'user',
        inputSummary: `userId=${event.ctx.userId}`,
    });
    sessionAuditIds.set(event.ctx.sessionId, execId);
}

export async function auditSessionEndHook(event: SessionEndEvent): Promise<HookResult | void> {
    const execId = sessionAuditIds.get(event.ctx.sessionId);
    if (!execId) return;

    auditRepository.updateExecution(execId, {
        status: 'success',
        outputSummary: `totalSteps=${event.totalSteps}`,
        finishedAt: new Date().toISOString(),
    });
    sessionAuditIds.delete(event.ctx.sessionId);
}

export async function auditToolSuccessHook(event: PostToolUseEvent): Promise<HookResult | void> {
    // 工具级别的审计日志（轻量，仅关键 tool 类型）
    // Phase 8 Admin Console 将提供更细粒度的过滤
    if (['shell', 'bash', 'file_manager', 'http_client'].includes(event.toolName)) {
        const execId = auditRepository.createExecution({
            type: 'agent',
            name: `tool:${event.toolName}`,
            sessionId: event.ctx.sessionId,
            triggerSource: 'user',
            inputSummary: JSON.stringify(event.toolInput).slice(0, 200),
        });
        auditRepository.updateExecution(execId, {
            status: 'success',
            durationMs: event.durationMs,
            finishedAt: new Date().toISOString(),
        });
    }
}

export async function auditToolFailureHook(event: PostToolUseFailureEvent): Promise<HookResult | void> {
    if (['shell', 'bash', 'file_manager', 'http_client'].includes(event.toolName)) {
        const execId = auditRepository.createExecution({
            type: 'agent',
            name: `tool:${event.toolName}`,
            sessionId: event.ctx.sessionId,
            triggerSource: 'user',
            inputSummary: JSON.stringify(event.toolInput).slice(0, 200),
        });
        auditRepository.updateExecution(execId, {
            status: 'failed',
            errorMessage: event.error.slice(0, 200),
            durationMs: event.durationMs,
            finishedAt: new Date().toISOString(),
        });
    }
}
