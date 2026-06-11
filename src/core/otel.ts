/**
 * OpenTelemetry 初始化模块（U4: OTel GenAI 语义约定双发导出）
 *
 * 仅当环境变量 OTEL_EXPORTER_OTLP_ENDPOINT 配置时才初始化。
 * 未配置时零开销 — 不加载任何 OTel 包，不影响现有功能。
 */

import type { Tracer, Span as OtelSpan } from '@opentelemetry/api';

export let otelEnabled = false;
let _tracer: Tracer | null = null;

/** GenAI 语义约定属性名（OTel Semantic Conventions v1.28+） */
export const GENAI_ATTRS = {
    SYSTEM: 'gen_ai.system',
    OPERATION_NAME: 'gen_ai.operation.name',
    REQUEST_MODEL: 'gen_ai.request.model',
    REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
    USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
    USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
    RESPONSE_FINISH_REASON: 'gen_ai.response.finish_reasons',
} as const;

export async function initOtel(): Promise<void> {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) return;

    try {
        const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
        const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
        const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
        const { Resource } = await import('@opentelemetry/resources');
        const { trace } = await import('@opentelemetry/api');

        const resource = new Resource({
            'service.name': process.env.OTEL_SERVICE_NAME ?? 'cmaster-bot',
            'service.version': process.env.npm_package_version ?? '0.0.0',
        });

        const otlpEndpoint = endpoint.endsWith('/v1/traces')
            ? endpoint
            : `${endpoint.replace(/\/$/, '')}/v1/traces`;

        const exporter = new OTLPTraceExporter({ url: otlpEndpoint });
        const provider = new NodeTracerProvider({
            resource,
        });
        provider.addSpanProcessor(new BatchSpanProcessor(exporter));
        provider.register();

        _tracer = trace.getTracer('cmaster-bot', process.env.npm_package_version ?? '1.0.0');
        otelEnabled = true;

        // 进程退出时优雅 flush
        process.once('SIGTERM', () => {
            provider.shutdown().catch(() => {});
        });
        process.once('beforeExit', () => {
            provider.forceFlush().catch(() => {});
        });

        console.log(`[otel] Initialized — exporting traces to ${otlpEndpoint}`);
    } catch (err) {
        console.warn(`[otel] Initialization failed (OTel disabled): ${(err as Error).message}`);
    }
}

export function getTracer(): Tracer | null {
    return _tracer;
}

export type { OtelSpan };
