export * from './approval.js';
export * from './postgres.js';

import type { AgentRevisionId } from '@cmaster/agents';
import type { OrganizationId, PrincipalId } from '@cmaster/identity';

export const GOVERNED_TOOL_ENTITLEMENT = 'enterprise_assistant.use_governed_tools';
export const SLICE3_POLICY_VERSION = 'slice3-baseline-v1';

export interface PolicyRequest {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  agentRevisionId: AgentRevisionId;
  principalEntitlements: readonly string[];
  agentGranted: boolean;
  toolRevisionActive: boolean;
  capabilityId: string;
}

export type PolicyDecision =
  | {
    effect: 'deny';
    policyVersion: typeof SLICE3_POLICY_VERSION;
    reason:
      | 'missing_principal_entitlement'
      | 'agent_tool_not_granted'
      | 'tool_revision_inactive'
      | 'unknown_tool_capability';
    obligations: readonly [];
  }
  | {
    effect: 'allow';
    policyVersion: typeof SLICE3_POLICY_VERSION;
    reason: 'baseline_tool_allowed';
    obligations: readonly [] | readonly [{ kind: 'employee_confirmation' }];
  };

export interface PolicyModule {
  evaluate(request: PolicyRequest): Promise<PolicyDecision>;
}

/** Evaluates the fixed, deny-by-default Policy for the first governed Tool slice. */
export class Slice3BaselinePolicy implements PolicyModule {
  async evaluate(request: PolicyRequest): Promise<PolicyDecision> {
    if (!request.principalEntitlements.includes(GOVERNED_TOOL_ENTITLEMENT)) {
      return {
        effect: 'deny',
        policyVersion: SLICE3_POLICY_VERSION,
        reason: 'missing_principal_entitlement',
        obligations: [],
      };
    }
    if (!request.agentGranted) {
      return {
        effect: 'deny',
        policyVersion: SLICE3_POLICY_VERSION,
        reason: 'agent_tool_not_granted',
        obligations: [],
      };
    }
    if (!request.toolRevisionActive) {
      return {
        effect: 'deny',
        policyVersion: SLICE3_POLICY_VERSION,
        reason: 'tool_revision_inactive',
        obligations: [],
      };
    }
    if (request.capabilityId === 'cmaster.utility.current_time:v1'
      || request.capabilityId === 'cmaster.utility.text_statistics:v1') {
      return {
        effect: 'allow',
        policyVersion: SLICE3_POLICY_VERSION,
        reason: 'baseline_tool_allowed',
        obligations: [],
      };
    }
    if (request.capabilityId === 'cmaster.http.fetch:v1') {
      return {
        effect: 'allow',
        policyVersion: SLICE3_POLICY_VERSION,
        reason: 'baseline_tool_allowed',
        obligations: [{ kind: 'employee_confirmation' }],
      };
    }
    return {
      effect: 'deny',
      policyVersion: SLICE3_POLICY_VERSION,
      reason: 'unknown_tool_capability',
      obligations: [],
    };
  }
}
