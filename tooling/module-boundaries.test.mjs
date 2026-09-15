import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { glob } from 'glob';
import { checkWorkspaceImports, validateImport } from './check-import-boundaries.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('allows imports through a workspace package root', () => {
  const source = path.join(root, 'apps/server/src/example.ts');
  assert.equal(validateImport(source, '@cmaster/contracts', root), undefined);
});

test('rejects deep workspace imports', () => {
  const source = path.join(root, 'apps/server/src/example.ts');
  assert.match(
    validateImport(source, '@cmaster/contracts/src/system-status', root) ?? '',
    /Deep workspace import/,
  );
});

test('rejects relative imports that cross package ownership', () => {
  const source = path.join(root, 'packages/kernel/src/example.ts');
  assert.match(
    validateImport(source, '../../contracts/src/index.ts', root) ?? '',
    /crosses workspace packages/,
  );
});

test('current workspace contains no import-boundary violations', async () => {
  assert.deepEqual(await checkWorkspaceImports(root), []);
});

test('public Contracts expose no framework, runtime, database, or filesystem types', async () => {
  const files = await glob('packages/contracts/src/**/*.{ts,tsx}', {
    cwd: root,
    ignore: ['**/*.test.ts', '**/generated/**'],
  });
  const forbidden = /^(?:react|next(?:\/|$)|ai(?:\/|$)|@ai-sdk\/|@fastify\/|fastify(?:\/|$)|pg(?:\/|$)|postgres(?:\/|$)|@?prisma\/|drizzle|kysely|node:(?:fs|path)(?:\/|$))/u;
  const violations = [];
  for (const relativeFile of files) {
    const source = await readFile(path.join(root, relativeFile), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
      if (forbidden.test(match[1])) violations.push(`${relativeFile}: ${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('PostgreSQL adapters query only tables owned by their Module', async () => {
  const ownership = {
    identity: new Set(['organizations', 'principals']),
    workspaces: new Set([
      'workspaces', 'workspace_roots', 'workspace_revisions', 'workspace_operation_receipts',
    ]),
    agents: new Set(['agents', 'agent_revisions']),
    conversations: new Set(['conversations', 'messages', 'conversation_rename_receipts']),
    artifacts: new Set(['artifacts', 'artifact_versions', 'artifact_contents']),
    context: new Set(['context_manifests', 'context_manifest_items', 'context_summaries']),
    execution: new Set([
      'runs', 'invocations', 'run_events', 'execution_outbox', 'run_dispatch',
      'run_command_receipts', 'execution_checkpoints', 'execution_interrupts',
    ]),
    models: new Set(['model_profiles', 'model_calls']),
    governance: new Set(['approvals']),
    tools: new Set([
      'tool_capabilities', 'tool_revisions', 'tool_grants', 'agent_tool_grants',
      'tool_calls', 'tool_dispatch_attempts',
    ]),
  };
  const files = {
    identity: 'packages/identity/src/index.ts',
    workspaces: 'packages/workspaces/src/index.ts',
    agents: 'packages/agents/src/index.ts',
    conversations: 'packages/conversations/src/index.ts',
    artifacts: 'packages/artifacts/src/postgres.ts',
    context: 'packages/context/src/postgres.ts',
    execution: 'packages/execution/src/postgres.ts',
    models: 'packages/models/src/postgres.ts',
    governance: 'packages/governance/src/postgres.ts',
    tools: 'packages/tools/src/postgres.ts',
  };
  for (const [moduleName, relativeFile] of Object.entries(files)) {
    const source = await readFile(path.join(root, relativeFile), 'utf8');
    const referenced = [...source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/g)]
      .map((match) => match[1]);
    const foreign = referenced.filter((table) => !ownership[moduleName].has(table));
    assert.deepEqual(foreign, [], `${moduleName} queries foreign tables: ${foreign.join(', ')}`);
  }
});
