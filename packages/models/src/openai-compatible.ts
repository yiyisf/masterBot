import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  InvalidPromptError,
  dynamicTool,
  jsonSchema,
  streamText,
  type ModelMessage,
} from 'ai';
import type {
  ModelAdapter,
  ModelAdapterEvent,
  ModelAdapterRequest,
  ModelFailure,
  ModelFailureCode,
  ModelTranscriptMessage,
  ModelUsage,
} from './types.js';

function safeFailure(code: ModelFailureCode, retryable: boolean): ModelFailure {
  const messages: Record<ModelFailureCode, string> = {
    rate_limited: 'The model provider is rate limited.',
    timeout: 'The model provider timed out.',
    provider_unavailable: 'The model provider is temporarily unavailable.',
    connection_failed: 'The model provider could not be reached.',
    stream_interrupted: 'The model stream was interrupted.',
    authentication_failed: 'The model provider credentials were rejected.',
    invalid_request: 'The model request was rejected.',
    context_length_exceeded: 'The model input exceeds the supported context length.',
    content_policy_refusal: 'The model provider refused the request for safety reasons.',
    unsupported_capability: 'The selected model does not support the required capability.',
    budget_exceeded: 'The model request exceeds the configured budget.',
    unknown_provider_error: 'The model provider could not complete the request.',
  };
  return { code, message: messages[code], retryable };
}

function classifyStatus(statusCode: number | undefined): ModelFailure | undefined {
  if (statusCode === 401 || statusCode === 403) return safeFailure('authentication_failed', false);
  if (statusCode === 408 || statusCode === 504) return safeFailure('timeout', true);
  if (statusCode === 429) return safeFailure('rate_limited', true);
  if (statusCode !== undefined && statusCode >= 500) return safeFailure('provider_unavailable', true);
  if (statusCode !== undefined && statusCode >= 400) return safeFailure('invalid_request', false);
  return undefined;
}

function classifyProviderBody(body: string | undefined): ModelFailure | undefined {
  const value = body?.toLowerCase();
  if (!value) return undefined;
  if (/(context[_ -]?length|maximum context|too many tokens)/.test(value)) {
    return safeFailure('context_length_exceeded', false);
  }
  if (/(content[_ -]?policy|safety refusal|safety system|moderation)/.test(value)) {
    return safeFailure('content_policy_refusal', false);
  }
  if (/(unsupported|does not support|not supported)/.test(value)) {
    return safeFailure('unsupported_capability', false);
  }
  if (/(budget|spending limit|insufficient quota)/.test(value)) {
    return safeFailure('budget_exceeded', false);
  }
  return undefined;
}

function normalizedUsage(usage: Awaited<ReturnType<typeof streamText>['usage']>): ModelUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  };
}

function providerMessages(transcript: readonly ModelTranscriptMessage[]): ModelMessage[] {
  return transcript.map((message): ModelMessage => {
    if (message.role === 'user') return { role: 'user', content: message.text };
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: [
          ...(message.text.length > 0 ? [{ type: 'text' as const, text: message.text }] : []),
          ...message.toolRequests.map((request) => ({
            type: 'tool-call' as const,
            toolCallId: request.requestId,
            toolName: request.name,
            input: request.input,
          })),
        ],
      };
    }
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: message.requestId,
        toolName: message.name,
        output: { type: 'text', value: JSON.stringify(message.output) ?? 'null' },
      }],
    };
  });
}

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;

  async *stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    const provider = createOpenAI({
      apiKey: request.apiKey,
      baseURL: request.profile.baseUrl,
      // 每个 Profile 独立创建 Provider，避免不同企业端点或凭据在进程内串用。
      name: `cmaster-${request.profile.id}`,
    });
    const tools = request.tools && request.tools.length > 0
      ? Object.fromEntries(request.tools.map((item) => [
        item.name,
        dynamicTool({
          description: item.description,
          inputSchema: jsonSchema(item.inputSchema),
          outputSchema: jsonSchema(item.outputSchema),
        }),
      ]))
      : undefined;
    const result = streamText({
      // OpenAI-compatible gateways 普遍实现 Chat Completions；避免默认切到仅 OpenAI 支持的 Responses API。
      model: provider.chat(request.profile.providerModelId),
      ...(request.transcript
        ? { messages: providerMessages(request.transcript) }
        : { prompt: request.prompt }),
      ...(tools ? { tools } : {}),
      abortSignal: request.signal,
      // 重试和 Fallback 必须由 Model Module 记录，禁止 SDK 在内部静默重试。
      maxRetries: 0,
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta' && part.text.length > 0) {
        yield { type: 'text_delta', text: part.text };
      } else if (part.type === 'tool-call') {
        yield {
          type: 'tool_requested',
          request: {
            requestId: part.toolCallId,
            name: part.toolName,
            input: part.input,
          },
        };
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
    yield { type: 'completed', usage: normalizedUsage(await result.usage) };
  }

  classifyError(error: unknown, hadOutput: boolean): ModelFailure {
    if (APICallError.isInstance(error)) {
      // 只在内存中读取 Provider body 做分类；原始 body 不进入事件、数据库、Trace 或 Browser Contract。
      const byBody = classifyProviderBody(error.responseBody);
      if (byBody) return byBody;
      const byStatus = classifyStatus(error.statusCode);
      if (byStatus) return byStatus;
      return error.isRetryable
        ? safeFailure(hadOutput ? 'stream_interrupted' : 'provider_unavailable', true)
        : safeFailure('unknown_provider_error', false);
    }
    if (InvalidPromptError.isInstance(error)) return safeFailure('invalid_request', false);
    if (error instanceof DOMException && error.name === 'AbortError') {
      return safeFailure('timeout', true);
    }
    if (error instanceof TypeError) return safeFailure('connection_failed', true);
    return safeFailure(hadOutput ? 'stream_interrupted' : 'unknown_provider_error', hadOutput);
  }
}
