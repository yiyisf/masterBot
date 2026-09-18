import type { ConversationId, MessageId } from '@cmaster/conversations';
import type { OrganizationId, PrincipalId } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';
import type {
  WorkingRootId,
  WorkspaceId,
  WorkspaceInvocationId,
  WorkspaceRevisionId,
} from '@cmaster/workspaces';

export type ContextPolicyRevision = Brand<string, 'ContextPolicyRevision'>;

/**
 * Context Module-owned immutable policy limits pinned by Agent Revision. Values are
 * positive token counts; applying the Policy is constant time and performs no I/O.
 */
export interface ContextPolicy {
  readonly revision: ContextPolicyRevision;
  readonly maximumInputTokens: number;
  readonly safetyMarginTokens: number;
}

/** Creates the opaque identity used to reference an immutable Context Policy revision. */
export function contextPolicyRevision(value: string): ContextPolicyRevision {
  return value as ContextPolicyRevision;
}

/** Conservative structural reserve for fixed Agent/system framing in Slice 4. */
export const slice4BaselineFixedOverheadTokens = 256;

/** Fixed Slice 4 baseline; later policy changes require a new revision constant. */
export const slice4BaselineContextPolicy: ContextPolicy = Object.freeze({
  revision: contextPolicyRevision('slice4-context-v1'),
  maximumInputTokens: 65_536,
  safetyMarginTokens: 4_096,
});

/** Model limits consumed structurally by Context without depending on a Model Adapter type. */
export interface ContextModelBudget {
  readonly strictestContextWindowTokens: number;
  readonly maximumOutputTokens: number;
}

/**
 * Applies the immutable Context Policy to eligible model limits. The strictest Policy
 * or Context Window is reduced by the largest enforced output reserve and the Policy
 * safety margin. Throws before model I/O if no input remains. Constant time and pure.
 */
export function deriveEffectiveContextInputLimit(
  policy: ContextPolicy,
  modelBudget: ContextModelBudget,
): number {
  const strictestLimit = Math.min(
    policy.maximumInputTokens,
    modelBudget.strictestContextWindowTokens,
  );
  const effectiveLimit = strictestLimit
    - modelBudget.maximumOutputTokens
    - policy.safetyMarginTokens;
  if (!Number.isSafeInteger(effectiveLimit) || effectiveLimit <= 0) {
    throw new Error('Model Context capacity cannot preserve the Context Policy safety margin');
  }
  return effectiveLimit;
}

export type ContextManifestId = Brand<string, 'ContextManifestId'>;
export type ContextRunId = Brand<string, 'ContextRunId'>;
export type ContextInvocationId = Brand<string, 'ContextInvocationId'>;
export type ContextArtifactId = Brand<string, 'ContextArtifactId'>;
export type ContextArtifactVersionId = Brand<string, 'ContextArtifactVersionId'>;
export type ContextSummaryId = Brand<string, 'ContextSummaryId'>;
export type ContextSourceHash = Brand<string, 'ContextSourceHash'>;

/** Converts an Execution-owned Run reference at the Context boundary. */
export function contextRunId(value: string): ContextRunId {
  return value as ContextRunId;
}

/** Converts an Execution-owned Invocation reference at the Context boundary. */
export function contextInvocationId(value: string): ContextInvocationId {
  return value as ContextInvocationId;
}

/** Converts an Artifact reference at the Context boundary. */
export function contextArtifactId(value: string): ContextArtifactId {
  return value as ContextArtifactId;
}

/** Converts an Artifact Version reference at the Context boundary. */
export function contextArtifactVersionId(value: string): ContextArtifactVersionId {
  return value as ContextArtifactVersionId;
}

/** Creates the Context-owned identity for a derived Summary. */
export function contextSummaryId(value: string): ContextSummaryId {
  return value as ContextSummaryId;
}

/** Immutable source provenance retained by Context without copying source bodies. */
export type ContextManifestItem =
  | {
    readonly sourceKind: 'message';
    readonly sourceId: MessageId;
    readonly sourceSequence: number;
    readonly sourceHash: ContextSourceHash;
    readonly provenance: 'employee_message' | 'assistant_message';
    readonly trustClass: 'conversation';
    readonly inclusionMode: 'verbatim' | 'summary';
  }
  | {
    readonly sourceKind: 'artifact';
    readonly artifactId: ContextArtifactId;
    readonly sourceId: ContextArtifactVersionId;
    readonly sourceHash: ContextSourceHash;
    readonly provenance: 'artifact_version';
    readonly trustClass: 'reference';
    readonly inclusionMode: 'verbatim' | 'summary' | 'reference_only';
  }
  | {
    readonly sourceKind: 'summary';
    readonly sourceId: ContextSummaryId;
    readonly sourceHash: ContextSourceHash;
    readonly provenance: 'context_summary';
    readonly trustClass: 'reference';
    readonly inclusionMode: 'summary';
  }
  | {
    readonly sourceKind: 'workspace_file';
    readonly workspaceId: WorkspaceId;
    readonly workingRootId: WorkingRootId;
    readonly revisionId: WorkspaceRevisionId;
    readonly path: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly sourceHash: ContextSourceHash;
    readonly provenance: 'workspace_revision_file';
    readonly trustClass: 'reference';
    readonly inclusionMode: 'verbatim';
  };

/** Organization-scoped provenance envelope; base selection is fixed and Tool reads append only. */
export interface ContextManifest {
  readonly id: ContextManifestId;
  readonly organizationId: OrganizationId;
  readonly invocationId: ContextInvocationId;
  readonly conversationId: ConversationId;
  readonly triggerMessageId: MessageId;
  readonly triggerSequence: number;
  readonly contextPolicyRevision: ContextPolicyRevision;
  readonly effectiveInputTokens: number;
  readonly estimatedInputTokens: number;
  readonly fixedOverheadTokens: number;
  readonly itemCount: number;
  readonly summarized: boolean;
  readonly items: readonly ContextManifestItem[];
  readonly createdAt: Date;
}

/** One Engine-neutral materialized Message with an explicit trust classification. */
export interface InvocationContextMessage {
  readonly role: 'user' | 'assistant' | 'reference';
  readonly text: string;
  readonly trustClass: 'conversation' | 'reference';
}

/** Bounded materialized input tied to exactly one immutable Manifest. */
export interface InvocationContext {
  readonly manifestId: ContextManifestId;
  readonly messages: readonly InvocationContextMessage[];
}

/** Stable Invocation/source identities and approved limits required for Context selection. */
export interface BuildInvocationContext {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  invocationId: ContextInvocationId;
  conversationId: ConversationId;
  triggerMessageId: MessageId;
  modelBudget: ContextModelBudget;
  fixedOverheadTokens: number;
  summaryExecution?: {
    runId: ContextRunId;
    signal: AbortSignal;
  };
}

/** Atomic build result containing auditable metadata and its verified materialization. */
export interface BuiltInvocationContext {
  manifest: ContextManifest;
  invocationContext: InvocationContext;
}

/** Organization-scoped request to verify and materialize a completed Manifest. */
export interface MaterializeInvocationContext {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  manifestId: ContextManifestId;
}

/**
 * Context Module seam for immutable, Invocation-scoped selection and Engine-neutral
 * materialization. Build is idempotent by Organization/Invocation and linear in selected
 * history size. Missing sources, integrity mismatches, and over-budget mandatory input fail.
 */
export interface ContextBuilder {
  build(request: BuildInvocationContext): Promise<BuiltInvocationContext>;
  materialize(request: MaterializeInvocationContext): Promise<InvocationContext>;
}

export interface RecordOpenedWorkspaceFile {
  readonly organizationId: OrganizationId;
  readonly invocationId: WorkspaceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Records only files actually opened into the private Model Tool transcript. */
export interface WorkspaceFileContextRecorder {
  recordOpenedFile(input: RecordOpenedWorkspaceFile): Promise<void>;
}

/** Non-retryable failure when mandatory Context cannot fit the approved budget. */
export class ContextInputTooLargeError extends Error {}
/** Temporary explicit failure until the over-budget Summary path is implemented. */
export class ContextCompressionRequiredError extends Error {}
/** Classified internal Context build failure; public Run output remains aggregate and safe. */
export class ContextBuildFailureError extends Error {
  constructor(readonly retryable: boolean) {
    super('Invocation Context build failed');
  }
}

/** Safe aggregate for missing or changed Context sources and malformed Manifest data. */
export class ContextSourceIntegrityError extends Error {}

/** Conservative deterministic estimate: one token per UTF-8 byte plus framing. */
export function estimateConservativeUtf8Tokens(
  text: string,
  framingTokens = 0,
): number {
  if (!Number.isSafeInteger(framingTokens) || framingTokens < 0) {
    throw new Error('Context framing estimate must be a non-negative safe integer');
  }
  return Buffer.byteLength(text, 'utf8') + framingTokens;
}

