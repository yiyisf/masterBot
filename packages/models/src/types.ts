import type { OrganizationId } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ModelProfileId = Brand<string, 'ModelProfileId'>;
export type ModelCallId = Brand<string, 'ModelCallId'>;

export type ModelRouteRole = 'primary' | 'fallback';
export type ModelFailureCode =
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'connection_failed'
  | 'stream_interrupted'
  | 'authentication_failed'
  | 'invalid_request'
  | 'context_length_exceeded'
  | 'content_policy_refusal'
  | 'unsupported_capability'
  | 'budget_exceeded'
  | 'unknown_provider_error';

export interface ModelFailure {
  code: ModelFailureCode;
  message: string;
  retryable: boolean;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelProfile {
  id: ModelProfileId;
  organizationId: OrganizationId;
  displayName: string;
  routeRole: ModelRouteRole;
  providerKind: 'openai-compatible';
  baseUrl: string;
  providerModelId: string;
  credentialRef: string;
  capabilities: { streamingText: true };
  dataHandlingTier: string;
  costTier: string;
}

export interface ModelSelection {
  id: ModelProfileId;
  displayName: string;
}

export interface ModelCall {
  id: ModelCallId;
  organizationId: OrganizationId;
  runId: string;
  invocationId: string;
  modelProfileId: ModelProfileId;
  attemptNumber: number;
  routeRole: ModelRouteRole;
  status: 'running' | 'succeeded' | 'failed' | 'discarded';
  hadOutput: boolean;
  usage?: ModelUsage;
  failure?: ModelFailure;
  traceId?: string;
  spanId?: string;
}

export interface ModelProfileProvisioning {
  id: ModelProfileId;
  displayName: string;
  routeRole: ModelRouteRole;
  baseUrl: string;
  providerModelId: string;
  credentialRef: string;
  dataHandlingTier: string;
  costTier: string;
}

export interface ModelAvailableTool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  outputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequestedTool {
  requestId: string;
  name: string;
  input: unknown;
}

export interface ModelInvocationRequest {
  organizationId: OrganizationId;
  runId: string;
  invocationId: string;
  prompt: string;
  tools?: readonly ModelAvailableTool[];
  signal: AbortSignal;
}

export type ModelEvent =
  | { type: 'model_selected'; callId: ModelCallId; profile: ModelSelection; fallback: boolean }
  | { type: 'text_delta'; text: string }
  | { type: 'model_output_discarded'; profileId: ModelProfileId; reason: 'fallback' | 'failure' }
  | { type: 'model_fallback_selected'; fromProfileId: ModelProfileId; toProfile: ModelSelection }
  | { type: 'model_completed'; callId: ModelCallId; profile: ModelSelection; usage: ModelUsage; fallbackUsed: boolean }
  | { type: 'tool_requested'; request: ModelRequestedTool }
  | { type: 'model_failed'; callId: ModelCallId; profile: ModelSelection; failure: ModelFailure; hadOutput: boolean };

export interface ModelAdapterRequest {
  profile: ModelProfile;
  apiKey: string;
  prompt: string;
  tools?: readonly ModelAvailableTool[];
  signal: AbortSignal;
}

export type ModelAdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_requested'; request: ModelRequestedTool }
  | { type: 'completed'; usage: ModelUsage };

/**
 * Provider Adapter 的公开 seam。SDK 类型必须在 Adapter 内终止。
 * Adapter 不做隐藏重试；错误原样抛给 Model Module，由后者统一分类和决定 Fallback。
 */
export interface ModelAdapter {
  readonly providerKind: 'openai-compatible';
  stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent>;
  classifyError(error: unknown, hadOutput: boolean): ModelFailure;
}

/**
 * Model Module 的深 Interface：选择 Profile、记录 ModelCall、执行 Provider、归一化 usage 与受控 Fallback。
 * 调用返回严格有序的事件流；同一次调用最多 Primary 与一个 Fallback，且每次 Provider I/O 前已持久化 ModelCall。
 * provision 幂等但拒绝缺失 Credential、同 ID 配置冲突和越权 Fallback；stream 的 Provider/数据库失败以安全事件或异常结束。
 * Profile 查询使用 Organization/route 索引；listCalls 使用 (Organization, Run) 索引，结果受 Invocation attempt 上限约束。
 */
export interface ModelGateway {
  provision(organizationId: OrganizationId, profiles: readonly ModelProfileProvisioning[]): Promise<void>;
  stream(request: ModelInvocationRequest): AsyncIterable<ModelEvent>;
  listCalls(organizationId: OrganizationId, runId: string): Promise<ModelCall[]>;
}

export function modelProfileId(value: string): ModelProfileId {
  return value as ModelProfileId;
}
