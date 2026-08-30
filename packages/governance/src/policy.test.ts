import { agentRevisionId } from '@cmaster/agents';
import { organizationId, principalId } from '@cmaster/identity';
import { describe, expect, it } from 'vitest';
import { Slice3BaselinePolicy } from './index.js';

describe('Slice3BaselinePolicy', () => {
  it('denies Tool use when the initiating Principal lacks the governed-tool entitlement', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: [],
      agentGranted: true,
      toolRevisionActive: true,
      capabilityId: 'cmaster.utility.current_time:v1',
    });

    expect(decision).toEqual({
      effect: 'deny',
      policyVersion: 'slice3-baseline-v1',
      reason: 'missing_principal_entitlement',
      obligations: [],
    });
  });

  it('denies a Capability that the Agent Revision was not granted', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: false,
      toolRevisionActive: true,
      capabilityId: 'cmaster.utility.current_time:v1',
    });

    expect(decision).toEqual({
      effect: 'deny',
      policyVersion: 'slice3-baseline-v1',
      reason: 'agent_tool_not_granted',
      obligations: [],
    });
  });

  it('denies an inactive Tool Revision', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: true,
      toolRevisionActive: false,
      capabilityId: 'cmaster.utility.current_time:v1',
    });

    expect(decision).toEqual({
      effect: 'deny',
      policyVersion: 'slice3-baseline-v1',
      reason: 'tool_revision_inactive',
      obligations: [],
    });
  });

  it('allows the low-risk current-time Capability without an obligation', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: true,
      toolRevisionActive: true,
      capabilityId: 'cmaster.utility.current_time:v1',
    });

    expect(decision).toEqual({
      effect: 'allow',
      policyVersion: 'slice3-baseline-v1',
      reason: 'baseline_tool_allowed',
      obligations: [],
    });
  });

  it('requires Employee Confirmation for the allowlisted HTTP fetch Capability', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: true,
      toolRevisionActive: true,
      capabilityId: 'cmaster.http.fetch:v1',
    });

    expect(decision).toEqual({
      effect: 'allow',
      policyVersion: 'slice3-baseline-v1',
      reason: 'baseline_tool_allowed',
      obligations: [{ kind: 'employee_confirmation' }],
    });
  });

  it('allows the low-risk text-statistics Capability without an obligation', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: true,
      toolRevisionActive: true,
      capabilityId: 'cmaster.utility.text_statistics:v1',
    });

    expect(decision).toEqual({
      effect: 'allow',
      policyVersion: 'slice3-baseline-v1',
      reason: 'baseline_tool_allowed',
      obligations: [],
    });
  });

  it('denies unknown Capabilities by default', async () => {
    const policy = new Slice3BaselinePolicy();

    const decision = await policy.evaluate({
      organizationId: organizationId('10000000-0000-4000-8000-000000000001'),
      principalId: principalId('20000000-0000-4000-8000-000000000001'),
      agentRevisionId: agentRevisionId('30000000-0000-4000-8000-000000000001'),
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      agentGranted: true,
      toolRevisionActive: true,
      capabilityId: 'provider.invented.tool:v1',
    });

    expect(decision).toEqual({
      effect: 'deny',
      policyVersion: 'slice3-baseline-v1',
      reason: 'unknown_tool_capability',
      obligations: [],
    });
  });
});
