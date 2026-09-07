import {
  CreateTextArtifactToolProvider,
  PostgresArtifactModule,
} from '@cmaster/artifacts';
import { PostgresApprovalModule, Slice3BaselinePolicy } from '@cmaster/governance';
import { organizationId, principalId } from '@cmaster/identity';
import { PostgresToolRuntime, type ToolProvider } from '@cmaster/tools';
import { Pool } from 'pg';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const pool = new Pool({ connectionString: required('DATABASE_URL') });
const realProvider = new CreateTextArtifactToolProvider(
  new PostgresArtifactModule(pool, required('TEST_ARTIFACT_STORAGE_ROOT')),
);
const crashingProvider: ToolProvider = {
  key: realProvider.key,
  summarize: (input) => realProvider.summarize(input),
  async execute(request) {
    await realProvider.execute(request);
    process.exit(86);
  },
  reconcile: (request) => realProvider.reconcile(request),
};
const runtime = new PostgresToolRuntime(
  pool,
  new Slice3BaselinePolicy(),
  new PostgresApprovalModule(pool),
  [crashingProvider],
  undefined,
  { providerTimeoutMs: 100 },
);
await runtime.invoke({
  identity: {
    organizationId: organizationId(required('TEST_ORGANIZATION_ID')),
    principalId: principalId(required('TEST_PRINCIPAL_ID')),
    principalType: 'employee',
    displayName: 'Crash Fixture Employee',
  },
  agentRevisionId: required('TEST_AGENT_REVISION_ID') as never,
  principalEntitlements: ['enterprise_assistant.use_governed_tools'],
  runId: required('TEST_RUN_ID'),
  invocationId: required('TEST_INVOCATION_ID'),
  modelRequestId: required('TEST_MODEL_REQUEST_ID'),
  capabilityId: 'cmaster.artifact.create_text:v1',
  input: {
    title: 'Crash-safe Artifact',
    format: 'plain_text',
    content: 'committed before ToolOutcome',
  },
  signal: new AbortController().signal,
});
