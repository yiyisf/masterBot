import { randomUUID } from 'node:crypto';
import type { OrganizationId } from '@cmaster/identity';
import { SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import type { Pool } from 'pg';
import type {
  ModelAdapter,
  ModelCall,
  ModelCallId,
  ModelCallPurpose,
  ModelContextBudget,
  ModelEvent,
  ModelFailure,
  ModelGateway,
  ModelInvocationRequest,
  ModelProfile,
  ModelProfileId,
  ModelProfileProvisioning,
  ModelRequestedTool,
  ModelUsage,
  ResolveModelContextBudget,
} from './types.js';

class ModelCallSupersededError extends Error {}

function isPostgresFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

interface ProfileRow {
  id: string;
  organization_id: string;
  display_name: string;
  route_role: 'primary' | 'fallback';
  provider_kind: 'openai-compatible';
  base_url: string;
  provider_model_id: string;
  credential_ref: string;
  capabilities: { streamingText?: unknown; toolCalling?: unknown };
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  data_handling_tier: string;
  cost_tier: string;
}

interface CallRow {
  id: string;
  organization_id: string;
  run_id: string;
  invocation_id: string;
  model_profile_id: string;
  purpose: ModelCallPurpose;
  attempt_number: number;
  route_role: 'primary' | 'fallback';
  status: 'running' | 'succeeded' | 'failed' | 'discarded';
  had_output: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  failure: ModelFailure | null;
  trace_id: string | null;
  span_id: string | null;
}

export interface PostgresModelGatewayOptions {
  credentials: ReadonlyMap<string, string>;
  tracer?: Tracer;
  onProviderError?: (error: unknown, context: { runId: string; invocationId: string; profileId: ModelProfileId }) => void;
}

function mapProfile(row: ProfileRow): ModelProfile {
  if (row.capabilities.streamingText !== true) {
    throw new Error(`Model Profile ${row.id} does not support streaming text`);
  }
  return {
    id: row.id as ModelProfileId,
    organizationId: row.organization_id as OrganizationId,
    displayName: row.display_name,
    routeRole: row.route_role,
    providerKind: row.provider_kind,
    baseUrl: row.base_url,
    providerModelId: row.provider_model_id,
    credentialRef: row.credential_ref,
    capabilities: {
      streamingText: true,
      toolCalling: row.capabilities.toolCalling === true,
    },
    ...(row.context_window_tokens === null || row.max_output_tokens === null
      ? {}
      : {
        contextLimits: {
          contextWindowTokens: row.context_window_tokens,
          maxOutputTokens: row.max_output_tokens,
        },
      }),
    dataHandlingTier: row.data_handling_tier,
    costTier: row.cost_tier,
  };
}

function safeSelection(profile: ModelProfile): { id: ModelProfileId; displayName: string } {
  return { id: profile.id, displayName: profile.displayName };
}

function mapCall(row: CallRow): ModelCall {
  const hasUsage = row.input_tokens !== null && row.output_tokens !== null && row.total_tokens !== null;
  return {
    id: row.id as ModelCallId,
    organizationId: row.organization_id as OrganizationId,
    runId: row.run_id,
    invocationId: row.invocation_id,
    modelProfileId: row.model_profile_id as ModelProfileId,
    purpose: row.purpose,
    attemptNumber: row.attempt_number,
    routeRole: row.route_role,
    status: row.status,
    hadOutput: row.had_output,
    ...(hasUsage ? {
      usage: {
        inputTokens: row.input_tokens!,
        outputTokens: row.output_tokens!,
        totalTokens: row.total_tokens!,
      },
    } : {}),
    ...(row.failure === null ? {} : { failure: row.failure }),
    ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
    ...(row.span_id === null ? {} : { spanId: row.span_id }),
  };
}

const postgresIntegerMaximum = 2_147_483_647;

function isPostgresPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= postgresIntegerMaximum;
}

function validateContextLimits(profile: ModelProfileProvisioning): void {
  if (!profile.contextLimits) return;
  const { contextWindowTokens, maxOutputTokens } = profile.contextLimits;
  if (!isPostgresPositiveInteger(contextWindowTokens)
    || !isPostgresPositiveInteger(maxOutputTokens)) {
    throw new Error(`Model Profile ${profile.id} Context limits must be positive PostgreSQL integers`);
  }
  if (contextWindowTokens <= maxOutputTokens) {
    throw new Error(`Model Profile ${profile.id} Context Window must exceed Max Output`);
  }
}

function sameProvisionedProfile(row: ProfileRow, profile: ModelProfileProvisioning): boolean {
  return row.id === profile.id
    && row.display_name === profile.displayName
    && row.route_role === profile.routeRole
    && row.base_url === profile.baseUrl
    && row.provider_model_id === profile.providerModelId
    && row.credential_ref === profile.credentialRef
    && row.data_handling_tier === profile.dataHandlingTier
    && row.cost_tier === profile.costTier
    && row.context_window_tokens === (profile.contextLimits?.contextWindowTokens ?? null)
    && row.max_output_tokens === (profile.contextLimits?.maxOutputTokens ?? null)
    && row.capabilities.streamingText === true
    && (row.capabilities.toolCalling === true) === profile.capabilities.toolCalling;
}

function traceIds(span: ReturnType<Tracer['startSpan']>): { traceId?: string; spanId?: string } {
  const context = span.spanContext();
  if (!trace.isSpanContextValid(context)) return {};
  return { traceId: context.traceId, spanId: context.spanId };
}

export class PostgresModelGateway implements ModelGateway {
  private readonly tracer: Tracer;

  constructor(
    private readonly pool: Pool,
    private readonly adapter: ModelAdapter,
    private readonly options: PostgresModelGatewayOptions,
  ) {
    this.tracer = options.tracer ?? trace.getTracer('@cmaster/models', '1');
  }

  private async resolveActiveProfiles(
    organizationId: OrganizationId,
    requiresToolCalling: boolean,
  ): Promise<{ primary: ModelProfile; fallback?: ModelProfile }> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT * FROM model_profiles
       WHERE organization_id = $1 AND status = 'active'
       ORDER BY CASE route_role WHEN 'primary' THEN 0 ELSE 1 END`,
      [organizationId],
    );
    const eligible = result.rows.map(mapProfile).filter((profile) => (
      !requiresToolCalling || profile.capabilities.toolCalling
    ));
    const primary = eligible.find((profile) => profile.routeRole === 'primary');
    if (!primary) throw new Error('Primary Model Profile is not provisioned');
    const fallback = eligible.find((profile) => profile.routeRole === 'fallback');
    return { primary, ...(fallback ? { fallback } : {}) };
  }

  async provision(
    organizationId: OrganizationId,
    profiles: readonly ModelProfileProvisioning[],
  ): Promise<void> {
    if (profiles.filter((profile) => profile.routeRole === 'primary').length !== 1) {
      throw new Error('Exactly one Primary Model Profile is required');
    }
    if (profiles.filter((profile) => profile.routeRole === 'fallback').length > 1) {
      throw new Error('At most one Fallback Model Profile is supported in Slice 2');
    }
    for (const profile of profiles) validateContextLimits(profile);
    const primary = profiles.find((profile) => profile.routeRole === 'primary')!;
    const fallback = profiles.find((profile) => profile.routeRole === 'fallback');
    if (fallback && (
      fallback.dataHandlingTier !== primary.dataHandlingTier
      || fallback.costTier !== primary.costTier
    )) {
      // Slice 2 尚无 Policy Engine；临时要求双 Profile 等级完全一致，避免 Fallback 扩大数据/成本权限。
      throw new Error('Fallback Model Profile must preserve Primary data handling and cost tiers');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE model_profiles SET status = 'inactive'
         WHERE organization_id = $1 AND status = 'active'
           AND NOT (id = ANY($2::uuid[]))`,
        [organizationId, profiles.map((profile) => profile.id)],
      );
      for (const profile of profiles) {
        if (!this.options.credentials.get(profile.credentialRef)) {
          throw new Error(`Credential is missing for Model Profile ${profile.id}`);
        }
        await client.query(
          `INSERT INTO model_profiles (
             id, organization_id, display_name, route_role, provider_kind,
             base_url, provider_model_id, credential_ref, capabilities,
             context_window_tokens, max_output_tokens, data_handling_tier, cost_tier
           ) VALUES ($1, $2, $3, $4, 'openai-compatible', $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [profile.id, organizationId, profile.displayName, profile.routeRole,
            profile.baseUrl, profile.providerModelId, profile.credentialRef,
            JSON.stringify(profile.capabilities), profile.contextLimits?.contextWindowTokens ?? null,
            profile.contextLimits?.maxOutputTokens ?? null, profile.dataHandlingTier, profile.costTier],
        );
        const existing = await client.query<ProfileRow>(
          `SELECT * FROM model_profiles WHERE organization_id = $1 AND id = $2`,
          [organizationId, profile.id],
        );
        if (!existing.rows[0] || !sameProvisionedProfile(existing.rows[0], profile)) {
          // Profile ID 一旦被 Run/ModelCall 引用便代表固定配置；修改时必须使用新 ID。
          throw new Error(`Model Profile ${profile.id} conflicts with an existing immutable profile`);
        }
        await client.query(
          `UPDATE model_profiles SET status = 'active'
           WHERE organization_id = $1 AND id = $2`,
          [organizationId, profile.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveContextBudget(
    request: ResolveModelContextBudget,
  ): Promise<ModelContextBudget> {
    const { primary, fallback } = await this.resolveActiveProfiles(
      request.organizationId,
      request.requiresToolCalling,
    );
    if (!primary.contextLimits) {
      throw new Error('Primary Model Profile does not declare Context limits');
    }
    const contextLimits = [primary.contextLimits];
    if (fallback) {
      if (!fallback.contextLimits) {
        throw new Error('Fallback Model Profile does not declare Context limits');
      }
      contextLimits.push(fallback.contextLimits);
    }
    return {
      primaryProfileId: primary.id,
      ...(fallback ? { fallbackProfileId: fallback.id } : {}),
      strictestContextWindowTokens: Math.min(
        ...contextLimits.map((limits) => limits.contextWindowTokens),
      ),
      maximumOutputTokens: Math.max(
        ...contextLimits.map((limits) => limits.maxOutputTokens),
      ),
    };
  }

  async *stream(request: ModelInvocationRequest): AsyncIterable<ModelEvent> {
    if (request.purpose === 'context_summary' && (request.tools?.length ?? 0) > 0) {
      throw new Error('Context Summary Model calls cannot enable Tools');
    }
    // Worker 恢复时，上一进程可能未能关闭 ModelCall；先把遗留 running 调用归一化为可审计失败。
    const interruptedFailure: ModelFailure = {
      code: 'stream_interrupted',
      message: 'The model stream was interrupted.',
      retryable: true,
    };
    await this.pool.query(
      `UPDATE model_calls SET status = 'failed', failure = $3,
         completed_at = clock_timestamp()
       WHERE organization_id = $1 AND invocation_id = $2 AND status = 'running'`,
      [request.organizationId, request.invocationId, JSON.stringify(interruptedFailure)],
    );
    const attemptResult = await this.pool.query<{ last_attempt: number }>(
      `SELECT COALESCE(MAX(attempt_number), 0)::integer AS last_attempt
       FROM model_calls WHERE organization_id = $1 AND invocation_id = $2`,
      [request.organizationId, request.invocationId],
    );
    const attemptBase = attemptResult.rows[0]?.last_attempt ?? 0;

    const { primary, fallback } = await this.resolveActiveProfiles(
      request.organizationId,
      (request.tools?.length ?? 0) > 0,
    );
    const attempts = fallback ? [primary, fallback] : [primary];

    for (const [index, profile] of attempts.entries()) {
      const fallbackAttempt = index > 0;
      const callId = randomUUID() as ModelCallId;
      const span = this.tracer.startSpan('gen_ai.chat', {
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': profile.providerKind,
          'gen_ai.request.model': profile.providerModelId,
          'cmaster.run.id': request.runId,
          'cmaster.invocation.id': request.invocationId,
          'cmaster.model_profile.id': profile.id,
          'cmaster.model.fallback': fallbackAttempt,
          'cmaster.model.purpose': request.purpose ?? 'agent_execution',
        },
      });
      const ids = traceIds(span);
      try {
        await this.pool.query(
          `INSERT INTO model_calls (
             id, organization_id, run_id, invocation_id, model_profile_id,
             purpose, attempt_number, route_role, status, trace_id, span_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9, $10)`,
          [callId, request.organizationId, request.runId, request.invocationId,
            profile.id, request.purpose ?? 'agent_execution', attemptBase + index + 1,
            profile.routeRole, ids.traceId ?? null, ids.spanId ?? null],
        );
      } catch (error) {
        span.addEvent('exception', { 'exception.type': 'model_persistence_failed' });
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'model_persistence_failed' });
        span.end();
        throw error;
      }
      yield { type: 'model_selected', callId, profile: safeSelection(profile), fallback: fallbackAttempt };

      let hadOutput = false;
      try {
        const apiKey = this.options.credentials.get(profile.credentialRef);
        if (!apiKey) throw new Error(`Credential ${profile.credentialRef} is unavailable`);
        let completedUsage: ModelUsage | undefined;
        const pendingToolRequests: ModelRequestedTool[] = [];
        for await (const event of this.adapter.stream({
          profile,
          apiKey,
          prompt: request.prompt,
          ...(request.transcript ? { transcript: request.transcript } : {}),
          ...(request.tools ? { tools: request.tools } : {}),
          signal: request.signal,
        })) {
          if (event.type === 'text_delta' || event.type === 'tool_requested') {
            if (!hadOutput) {
              hadOutput = true;
              const streaming = await this.pool.query(
                `UPDATE model_calls SET had_output = true WHERE id = $1 AND status = 'running'`,
                [callId],
              );
              if (streaming.rowCount !== 1) throw new ModelCallSupersededError();
            }
            if (event.type === 'text_delta') yield event;
            else pendingToolRequests.push(event.request);
          } else {
            completedUsage = event.usage;
          }
        }
        if (!completedUsage || !hadOutput) {
          throw new Error('Model stream ended without text and usage');
        }
        if ([completedUsage.inputTokens, completedUsage.outputTokens, completedUsage.totalTokens]
          .some((value) => !Number.isSafeInteger(value) || value < 0)) {
          throw new Error('Model provider returned invalid usage');
        }
        const completion = await this.pool.query(
          `UPDATE model_calls SET status = 'succeeded', had_output = $2,
             input_tokens = $3, output_tokens = $4, total_tokens = $5,
             completed_at = clock_timestamp()
           WHERE id = $1 AND status = 'running'`,
          [callId, hadOutput, completedUsage.inputTokens,
            completedUsage.outputTokens, completedUsage.totalTokens],
        );
        if (completion.rowCount !== 1) throw new ModelCallSupersededError();
        span.setAttributes({
          'gen_ai.usage.input_tokens': completedUsage.inputTokens,
          'gen_ai.usage.output_tokens': completedUsage.outputTokens,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        yield {
          type: 'model_completed',
          callId,
          profile: safeSelection(profile),
          usage: completedUsage,
          fallbackUsed: fallbackAttempt,
        };
        for (const toolRequest of pendingToolRequests) {
          yield { type: 'tool_requested', request: toolRequest };
        }
        return;
      } catch (error) {
        if (error instanceof ModelCallSupersededError || isPostgresFailure(error)) {
          // Persistence/fencing 失败不能伪装成 Provider failure 并触发额外付费 Fallback。
          span.addEvent('exception', { 'exception.type': 'model_persistence_failed' });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'model_persistence_failed' });
          span.end();
          throw error;
        }
        const failure = request.signal.aborted
          ? {
            code: 'stream_interrupted' as const,
            message: 'The model stream was interrupted.',
            retryable: true,
          }
          : this.adapter.classifyError(error, hadOutput);
        const canFallback = failure.retryable && index === 0 && fallback !== undefined;
        try {
          await this.pool.query(
            `UPDATE model_calls SET status = $2, had_output = $3, failure = $4,
               completed_at = clock_timestamp()
             WHERE id = $1 AND status = 'running'`,
            [callId, hadOutput ? 'discarded' : 'failed',
              hadOutput, JSON.stringify(failure)],
          );
        } catch (persistenceError) {
          span.addEvent('exception', { 'exception.type': 'model_persistence_failed' });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'model_persistence_failed' });
          span.end();
          throw persistenceError;
        }
        // Provider 原始异常可能含请求或响应内容；Trace 只记录安全分类，不记录 exception message。
        span.addEvent('exception', { 'exception.type': failure.code });
        span.setStatus({ code: SpanStatusCode.ERROR, message: failure.code });
        span.end();
        try {
          this.options.onProviderError?.(error, {
            runId: request.runId,
            invocationId: request.invocationId,
            profileId: profile.id,
          });
        } catch {
          // Logging/observability callback 不得改变 ModelCall 或 Fallback 语义。
        }
        if (!canFallback) {
          if (hadOutput) {
            yield { type: 'model_output_discarded', profileId: profile.id, reason: 'failure' };
          }
          yield { type: 'model_failed', callId, profile: safeSelection(profile), failure, hadOutput };
          return;
        }
        if (hadOutput) {
          yield { type: 'model_output_discarded', profileId: profile.id, reason: 'fallback' };
        }
        yield {
          type: 'model_fallback_selected',
          fromProfileId: profile.id,
          toProfile: safeSelection(fallback),
        };
      }
    }
  }

  async listCalls(organizationId: OrganizationId, runId: string): Promise<ModelCall[]> {
    const result = await this.pool.query<CallRow>(
      `SELECT * FROM model_calls
       WHERE organization_id = $1 AND run_id = $2
       ORDER BY attempt_number ASC`,
      [organizationId, runId],
    );
    return result.rows.map(mapCall);
  }
}
