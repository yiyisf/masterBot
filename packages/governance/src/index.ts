export * from './approval.js';
export * from './postgres.js';

import type { AgentRevisionId } from '@cmaster/agents';
import type { OrganizationId, PrincipalId } from '@cmaster/identity';

export const GOVERNED_TOOL_ENTITLEMENT = 'enterprise_assistant.use_governed_tools';
export const SLICE3_POLICY_VERSION = 'slice3-baseline-v1';
export const WORKSPACE_CHANGE_APPLY_POLICY_VERSION = 'slice6-workspace-change-apply-v1';

export type PolicyResource = {
  kind: 'workspace_change_apply';
  currentOperationMode: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
  maximumOperationMode: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
};

export interface PolicyRequest {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  agentRevisionId: AgentRevisionId;
  principalEntitlements: readonly string[];
  agentGranted: boolean;
  toolRevisionActive: boolean;
  capabilityId: string;
  resource?: PolicyResource;
}

export type PolicyDecision =
  | {
    effect: 'deny';
    policyVersion: typeof SLICE3_POLICY_VERSION | typeof WORKSPACE_CHANGE_APPLY_POLICY_VERSION;
    reason:
      | 'missing_principal_entitlement'
      | 'agent_tool_not_granted'
      | 'tool_revision_inactive'
      | 'workspace_operation_mode_denied'
      | 'unknown_tool_capability';
    obligations: readonly [];
  }
  | {
    effect: 'allow';
    policyVersion: typeof SLICE3_POLICY_VERSION | typeof WORKSPACE_CHANGE_APPLY_POLICY_VERSION;
    reason: 'baseline_tool_allowed';
    obligations: readonly [] | readonly [{ kind: 'employee_confirmation' }];
  };

export interface PolicyModule {
  evaluate(request: PolicyRequest): Promise<PolicyDecision>;
}

/** Evaluates the fixed, deny-by-default Policy for governed Tool capabilities. */
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
    if (request.capabilityId === 'cmaster.workspace.apply_changes:v1') {
      if (request.resource?.kind !== 'workspace_change_apply') {
        return {
          effect: 'deny',
          policyVersion: WORKSPACE_CHANGE_APPLY_POLICY_VERSION,
          reason: 'unknown_tool_capability',
          obligations: [],
        };
      }
      if (request.resource.currentOperationMode === 'observe'
        || request.resource.maximumOperationMode === 'observe') {
        return {
          effect: 'deny',
          policyVersion: WORKSPACE_CHANGE_APPLY_POLICY_VERSION,
          reason: 'workspace_operation_mode_denied',
          obligations: [],
        };
      }
      return {
        effect: 'allow',
        policyVersion: WORKSPACE_CHANGE_APPLY_POLICY_VERSION,
        reason: 'baseline_tool_allowed',
        obligations: request.resource.currentOperationMode === 'trusted_automation'
          && request.resource.maximumOperationMode === 'trusted_automation'
          ? []
          : [{ kind: 'employee_confirmation' }],
      };
    }
    if (request.capabilityId === 'cmaster.utility.current_time:v1'
      || request.capabilityId === 'cmaster.utility.text_statistics:v1'
      || request.capabilityId === 'cmaster.artifact.create_text:v1'
      || request.capabilityId === 'cmaster.workspace.list_files:v1'
      || request.capabilityId === 'cmaster.workspace.search_files:v1'
      || request.capabilityId === 'cmaster.workspace.open_file:v1'
      || request.capabilityId === 'cmaster.workspace.write_file:v1'
      || request.capabilityId === 'cmaster.workspace.delete_file:v1'
      || request.capabilityId === 'cmaster.workspace.propose_changes:v1') {
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
