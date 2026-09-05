import type { Brand } from '@cmaster/kernel';

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
