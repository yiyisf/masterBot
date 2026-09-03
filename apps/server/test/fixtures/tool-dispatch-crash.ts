import { PostgresApprovalModule, Slice3BaselinePolicy } from '@cmaster/governance';
import { agentRevisionId } from '@cmaster/agents';
import { organizationId, principalId } from '@cmaster/identity';
import { PostgresToolRuntime, type ToolProvider } from '@cmaster/tools';
import { Pool } from 'pg';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const pool = new Pool({ connectionString: required('DATABASE_URL') });
const provider: ToolProvider = {
  key: 'test:process-crash-time',
  summarize: () => ({ title: 'Read current time', details: {} }),
  async execute() {
    // 模拟进程在 Provider I/O 已开始、结果尚未写回 Ledger 时退出。
    process.exit(86);
  },
};
const runtime = new PostgresToolRuntime(
  pool,
  new Slice3BaselinePolicy(),
  new PostgresApprovalModule(pool),
  [provider],
);

await runtime.invoke({
  identity: {
    organizationId: organizationId(required('TEST_ORGANIZATION_ID')),
    principalId: principalId(required('TEST_PRINCIPAL_ID')),
    principalType: 'employee',
    displayName: 'Tool Process Recovery Employee',
  },
  agentRevisionId: agentRevisionId(required('TEST_AGENT_REVISION_ID')),
  principalEntitlements: ['enterprise_assistant.use_governed_tools'],
  runId: required('TEST_RUN_ID'),
  invocationId: required('TEST_INVOCATION_ID'),
  modelRequestId: required('TEST_MODEL_REQUEST_ID'),
  capabilityId: 'cmaster.utility.current_time:v1',
  input: {},
  signal: new AbortController().signal,
});

await pool.end();
process.exitCode = 1;
