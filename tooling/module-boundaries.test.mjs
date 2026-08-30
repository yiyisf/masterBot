import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
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

test('PostgreSQL adapters query only tables owned by their Module', async () => {
  const ownership = {
    identity: new Set(['organizations', 'principals']),
    agents: new Set(['agents', 'agent_revisions']),
    conversations: new Set(['conversations', 'messages']),
    execution: new Set(['runs', 'invocations', 'run_events', 'execution_outbox', 'run_dispatch', 'run_command_receipts']),
    models: new Set(['model_profiles', 'model_calls']),
    governance: new Set(['approvals']),
    tools: new Set(['tool_capabilities', 'tool_revisions', 'tool_grants']),
  };
  const files = {
    identity: 'packages/identity/src/index.ts',
    agents: 'packages/agents/src/index.ts',
    conversations: 'packages/conversations/src/index.ts',
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
