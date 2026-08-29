import assert from 'node:assert/strict';
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
