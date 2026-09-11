import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { commandId, PostgresConversationModule } from '@cmaster/conversations';
import {
  PostgresExecutionModule,
  runCommandId,
  type InterruptKind,
} from '@cmaster/execution';
import { approvalCommandId, PostgresApprovalModule } from '@cmaster/governance';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { InMemoryFeatureFlags } from '../src/feature-flags.js';
import { PollingRunEventNotifier } from '../src/run-event-notifier.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const creator = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Pending Interactions',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Initiating Employee',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Pending Interactions',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Other Employee',
});
const outsideOrganization = new PostgresDevelopmentIdentity(pool, {
  organizationId: organizationId(randomUUID()),
  organizationName: 'Outside Organization',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Outside Employee',
});
const revisionId = agentRevisionId(randomUUID());
const agents = new PostgresAgentModule(pool, {
  agentId: agentId(randomUUID()),
  echoRevisionId: revisionId,
  activeRevisionId: revisionId,
  name: 'Pending Agent',
});
const conversations = new PostgresConversationModule(pool);
const execution = new PostgresExecutionModule(pool);
const approvals = new PostgresApprovalModule(pool);
const config = loadServerConfig({
  DATABASE_URL: databaseUrl,
  CMASTER_RUNTIME_ENV: 'test',
  NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
}, []);

beforeAll(async () => {
  await creator.provision();
  await colleague.provision();
  await outsideOrganization.provision();
  await agents.provision(organization);
});
afterAll(async () => pool.end());

async function createWaitingRun(kind: InterruptKind, title: string) {
  const identity = creator.resolveRequest();
  const conversation = await conversations.create(identity, {
    commandId: commandId(randomUUID()), title,
  });
  const message = await conversations.appendEmployeeMessage(identity, conversation.value.id, {
    commandId: commandId(randomUUID()), parts: [{ type: 'text', text: title }],
  });
  const accepted = await execution.acceptRun(identity, {
    commandId: runCommandId(randomUUID()),
    conversationId: conversation.value.id,
    messageId: message.value.id,
    agent: await agents.resolveDefault(organization),
  });
  while (await execution.relayNextOutbox()) { /* 清空这个隔离 Fixture 的 Outbox。 */ }
  const lease = await execution.leaseNext(`pending-${randomUUID()}`, 5_000, 5);
  if (!lease || lease.runId !== accepted.value.id) throw new Error('Expected the new Run lease');
  const subjectRef = randomUUID();
  const approval = kind === 'tool_confirmation'
    ? (await approvals.request(identity, {
        commandId: approvalCommandId(subjectRef),
        subject: {
          kind: 'tool_call',
          subjectRef,
          toolRevisionRef: randomUUID(),
          requestHash: 'b'.repeat(64),
          safeSummary: { title, details: { host: 'docs.example.test' } },
        },
        policyVersion: 'slice3-baseline-v1',
      })).value
    : undefined;
  const interrupt = await execution.requestInterrupt(lease, {
    kind,
    subjectRef,
    safeSubjectSummary: { title, details: { host: 'docs.example.test' } },
    allowedResponses: kind === 'tool_confirmation'
      ? ['confirm', 'reject'] : ['continue_with_uncertainty'],
    checkpoint: {
      schemaVersion: 1,
      engineKind: lease.engineKind,
      engineVersion: '1',
      toolCallId: randomUUID(),
      outcome: kind === 'tool_confirmation' ? 'confirmation_required' : 'requires_review',
    },
  });
  return {
    conversation: conversation.value,
    message: message.value,
    run: accepted.value,
    interrupt,
    approval,
  };
}

function api(identity: PostgresDevelopmentIdentity) {
  return buildApi({
    config,
    database: { check: async () => true },
    featureFlags: new InMemoryFeatureFlags({ nextArchitecture: true, employeeWorkspace: true }),
    runApi: {
      identity, agents, conversations, execution, notifier: new PollingRunEventNotifier(),
    },
    workspaceApi: { identity, conversations, execution, approvals },
  });
}

describe('active Run Interrupt query', () => {
  it('retrieves immutable Approval Subjects by ToolCall reference only for the initiating Principal', async () => {
    const subjectRef = randomUUID();
    const requested = await approvals.request(creator.resolveRequest(), {
      commandId: approvalCommandId(randomUUID()),
      subject: {
        kind: 'tool_call',
        subjectRef,
        toolRevisionRef: randomUUID(),
        requestHash: 'a'.repeat(64),
        safeSummary: { title: 'Fetch the release guide', details: { host: 'docs.example.test' } },
      },
      policyVersion: 'slice3-baseline-v1',
    });

    await expect(approvals.listBySubjectRefs(creator.resolveRequest(), [subjectRef, randomUUID()]))
      .resolves.toEqual([requested.value]);
    await expect(approvals.listBySubjectRefs(colleague.resolveRequest(), [subjectRef]))
      .resolves.toEqual([]);
  });

  it('pages the initiating Principal’s exact active Interrupt references without exposing them to a colleague', async () => {
    const first = await createWaitingRun('tool_confirmation', 'Confirm documentation fetch');
    const second = await createWaitingRun('tool_outcome_review', 'Review uncertain delivery');
    const third = await createWaitingRun('tool_confirmation', 'Confirm final fetch');

    const newest = await execution.listActiveInterrupts(creator.resolveRequest(), { limit: 2 });
    expect(newest.items.map((item) => item.runId)).toEqual([third.run.id, second.run.id]);
    expect(newest.items[0]).toMatchObject({
      conversationId: third.conversation.id,
      triggerMessageId: third.message.id,
      interrupt: {
        id: third.interrupt.id,
        kind: 'tool_confirmation',
        safeSubjectSummary: { title: 'Confirm final fetch' },
      },
    });
    const nextCursor = newest.nextCursor;
    if (!nextCursor) throw new Error('Expected an older active Interrupt page');
    const older = await execution.listActiveInterrupts(creator.resolveRequest(), {
      limit: 2, cursor: nextCursor,
    });
    expect(older.items.map((item) => item.runId)).toEqual([first.run.id]);
    expect(older.nextCursor).toBeUndefined();
    await expect(execution.listActiveInterrupts(colleague.resolveRequest(), { limit: 20 }))
      .resolves.toEqual({ items: [] });
    await expect(execution.listActiveInterrupts(outsideOrganization.resolveRequest(), { limit: 20 }))
      .resolves.toEqual({ items: [] });
  });

  it('projects a recorded Approval decision without offering a second decision while the Run resumes', async () => {
    const waiting = await createWaitingRun('tool_confirmation', 'Resume after confirmation');
    if (!waiting.approval) throw new Error('Expected an Approval fixture');
    await approvals.resolve(creator.resolveRequest(), waiting.approval.id, {
      commandId: approvalCommandId(randomUUID()), response: 'confirm',
    });
    const creatorApi = api(creator);
    const response = await creatorApi.inject({
      method: 'GET', url: '/api/v1/workspace/interrupts?limit=1',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      interruptId: waiting.interrupt.id,
      decisionStatus: 'confirmed',
      allowedResponses: [],
    });
    await creatorApi.close();
  });

  it('serves a creator-private safe Pending projection with exact navigation references', async () => {
    const waiting = await createWaitingRun('tool_confirmation', 'Confirm the exact subject');
    const creatorApi = api(creator);
    const response = await creatorApi.inject({
      method: 'GET', url: '/api/v1/workspace/interrupts?limit=1',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        kind: 'employee_confirmation',
        decisionStatus: 'pending',
        conversationId: waiting.conversation.id,
        triggerMessageId: waiting.message.id,
        runId: waiting.run.id,
        interruptId: waiting.interrupt.id,
        createdAt: expect.any(String),
        allowedResponses: ['confirm', 'reject'],
        approvalSubject: {
          approvalId: waiting.approval?.id,
          title: 'Confirm the exact subject',
          details: { host: 'docs.example.test' },
        },
      }],
      nextCursor: expect.any(String),
    });
    expect(response.body).not.toContain('subjectRef');
    expect(response.body).not.toContain('requestHash');

    const colleagueApi = api(colleague);
    const privateResponse = await colleagueApi.inject({
      method: 'GET', url: '/api/v1/workspace/interrupts?limit=20',
    });
    expect(privateResponse.statusCode).toBe(200);
    expect(privateResponse.json()).toEqual({ items: [], nextCursor: null });
    await creatorApi.close();
    await colleagueApi.close();
  });
});
