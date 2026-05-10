import { NodeSDK, resources } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
    trace,
    context,
    Span,
    SpanStatusCode,
    SpanKind,
    type Tracer,
} from '@opentelemetry/api';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const { resourceFromAttributes } = resources;

// ─── GenAI Semantic Conventions (draft spec, 2026) ───────────────────────────
// https://opentelemetry.io/docs/specs/semconv/gen-ai/
const GEN_AI = {
    SYSTEM: 'gen_ai.system',
    REQUEST_MODEL: 'gen_ai.request.model',
    OPERATION_NAME: 'gen_ai.operation.name',
    USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
    USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
    USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read_input_tokens',
    RESPONSE_FINISH_REASON: 'gen_ai.response.finish_reasons',
} as const;

// ─── SDK 初始化 ───────────────────────────────────────────────────────────────

let _sdk: NodeSDK | null = null;

export function initOtel(options: {
    endpoint?: string;   // OTLP endpoint，默认 http://localhost:4318
    serviceName?: string;
    enabled?: boolean;
}): void {
    const enabled = options.enabled ?? process.env.OTEL_ENABLED !== 'false';
    if (!enabled) return;

    const endpoint = options.endpoint
        ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ?? 'http://localhost:4318';

    const exporter = new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
            ? Object.fromEntries(
                process.env.OTEL_EXPORTER_OTLP_HEADERS
                    .split(',')
                    .map(h => h.split('=') as [string, string])
              )
            : {},
    });

    _sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [SEMRESATTRS_SERVICE_NAME]: options.serviceName ?? 'masterbot',
            'service.version': process.env.npm_package_version ?? '0.1.0',
        }),
        traceExporter: exporter,
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
            }),
        ],
    });

    _sdk.start();

    process.on('SIGTERM', () => {
        _sdk?.shutdown().catch(() => {});
    });
}

export function shutdownOtel(): Promise<void> {
    return _sdk?.shutdown() ?? Promise.resolve();
}

// ─── OtelObserver ─────────────────────────────────────────────────────────────

export interface AgentSpanInput {
    sessionId: string;
    userId?: string;
    model?: string;
    provider?: string;
    traceId?: string;
}

export interface ModelUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
}

export class OtelObserver {
    private readonly tracer: Tracer;

    constructor(tracerName = 'masterbot', tracerVersion = '1.0.0') {
        this.tracer = trace.getTracer(tracerName, tracerVersion);
    }

    /**
     * 创建 agent 级别的 root span。
     * 遵循 OTel GenAI Semantic Conventions。
     */
    startAgentSpan(input: AgentSpanInput): Span {
        return this.tracer.startSpan('agent.run', {
            kind: SpanKind.INTERNAL,
            attributes: {
                [GEN_AI.SYSTEM]: input.provider ?? 'anthropic',
                [GEN_AI.REQUEST_MODEL]: input.model ?? 'unknown',
                [GEN_AI.OPERATION_NAME]: 'agent_loop',
                'agent.session_id': input.sessionId,
                'agent.user_id': input.userId ?? 'anonymous',
            },
        });
    }

    /**
     * 创建 tool 调用的子 span，parent 由调用方维护。
     */
    startToolSpan(toolName: string, parentSpan: Span): Span {
        const ctx = trace.setSpan(context.active(), parentSpan);
        return this.tracer.startSpan(
            `tool.${toolName}`,
            {
                kind: SpanKind.INTERNAL,
                attributes: {
                    'tool.name': toolName,
                },
            },
            ctx,
        );
    }

    /**
     * 创建 delegate（子 Agent）span。
     */
    startDelegateSpan(workerId: string, parentSpan: Span): Span {
        const ctx = trace.setSpan(context.active(), parentSpan);
        return this.tracer.startSpan(
            `delegate.${workerId}`,
            {
                kind: SpanKind.INTERNAL,
                attributes: { 'delegate.worker_id': workerId },
            },
            ctx,
        );
    }

    /**
     * 通用 span 创建（用于 SpanRecorder 内部桥接）。
     * parentSpan 为 undefined 时创建 root span。
     */
    startGenericSpan(name: string, attributes?: Record<string, string | number | boolean>, parentSpan?: Span): Span {
        const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
        return this.tracer.startSpan(
            name,
            { kind: SpanKind.INTERNAL, attributes },
            ctx,
        );
    }

    /**
     * 记录 LLM token 使用量（GenAI Semantic Conventions）。
     */
    recordModelUsage(span: Span, usage: ModelUsage): void {
        span.setAttributes({
            [GEN_AI.USAGE_INPUT_TOKENS]: usage.inputTokens,
            [GEN_AI.USAGE_OUTPUT_TOKENS]: usage.outputTokens,
            [GEN_AI.USAGE_CACHE_READ_INPUT_TOKENS]: usage.cacheReadInputTokens ?? 0,
        });
    }

    /**
     * 正常结束一个 span（success 或 error）。
     */
    endSpan(span: Span, options?: { result?: string; error?: string }): void {
        if (options?.error) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: options.error });
            span.setAttribute('error.message', options.error);
        } else {
            span.setStatus({ code: SpanStatusCode.OK });
            if (options?.result) {
                span.setAttribute('agent.result_preview', options.result.slice(0, 300));
            }
        }
        span.end();
    }
}

// ─── 默认单例 ─────────────────────────────────────────────────────────────────

export const otelObserver = new OtelObserver();
