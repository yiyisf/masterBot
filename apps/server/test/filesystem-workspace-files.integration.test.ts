import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  createConfiguredGitWorkspaceProvisioner,
  createConfiguredWorkspaceRevisionContentReader,
  PostgresWorkspaceCatalog,
  PostgresWorkspaceProvisioningWorker,
  InvalidWorkspaceCursorError,
  InvalidWorkspaceFileQueryError,
  PostgresWorkspaceWorkingRoots,
  WorkspaceNotFoundError,
  workspaceCommandId,
  workspaceRevisionId,
  workspaceConnectorId,
  workspaceRepositoryId,
} from '@cmaster/workspaces';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const run = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace files test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace files test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});
let fixtureRoot: string;

beforeAll(async () => {
  await owner.provision();
  await colleague.provision();
  fixtureRoot = await mkdtemp(join(tmpdir(), 'cmaster-files-integration-'));
});
afterAll(async () => {
  await pool.end();
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function createRemote(): Promise<{ remote: string; checkout: string }> {
  const remote = join(fixtureRoot, 'trusted.git');
  const checkout = join(fixtureRoot, 'checkout');
  await run('git', ['init', '--bare', remote]);
  await run('git', ['init', checkout]);
  await run('git', ['-C', checkout, 'config', 'user.name', 'CMaster Test']);
  await run('git', ['-C', checkout, 'config', 'user.email', 'cmaster@example.invalid']);
  await mkdir(join(checkout, 'src'), { recursive: true });
  await writeFile(join(checkout, 'README.md'), '# Fixed revision\n', 'utf8');
  await writeFile(join(checkout, 'src', 'app.ts'), [
    'export const first = true;',
    'export const searchable = "needle needle";',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(checkout, 'ignored.txt'), 'needle must remain private\n', 'utf8');
  await writeFile(join(checkout, '.cmasterignore'), 'ignored.txt\n', 'utf8');
  await run('git', ['-C', checkout, 'add', '.']);
  await run('git', ['-C', checkout, 'commit', '-m', 'initial']);
  await run('git', ['-C', checkout, 'branch', '-M', 'main']);
  await run('git', ['-C', checkout, 'remote', 'add', 'origin', remote]);
  await run('git', ['-C', checkout, 'push', '-u', 'origin', 'main']);
  return { remote, checkout };
}

describe('PostgreSQL fixed-Revision Workspace file reads', () => {
  it('lists, searches, and opens only owner-visible content pinned to the accepted Revision', async () => {
    const fixture = await createRemote();
    const storageRoot = join(fixtureRoot, 'content');
    const connectorId = workspaceConnectorId(randomUUID());
    const repositoryId = workspaceRepositoryId(randomUUID());
    const accepted = await new PostgresWorkspaceCatalog(pool).provisionGit(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Pinned files',
        operationMode: 'observe',
        source: { connectorId, repositoryId, defaultBranch: 'main' },
      },
    );
    const provisioner = createConfiguredGitWorkspaceProvisioner({
      storageRoot,
      repositories: [{ organizationId: organization, connectorId, repositoryId,
        remoteUrl: fixture.remote }],
    });
    await new PostgresWorkspaceProvisioningWorker(pool, provisioner, {
      workerId: 'files-provision-worker', leaseTtlMs: 30_000,
    }).executeOne();
    const ready = await new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), accepted.value.id,
    );
    if (!ready.defaultWorkingRoot) throw new Error('Expected default Working Root');
    const scope = {
      workspaceId: ready.id,
      workingRootId: ready.defaultWorkingRoot.id,
      revisionId: ready.defaultWorkingRoot.currentRevisionId,
    };
    const files = new PostgresWorkspaceWorkingRoots(pool, {
      revisionContent: createConfiguredWorkspaceRevisionContentReader({ storageRoot }),
    });

    await expect(files.listFiles(owner.resolveRequest(), scope, { limit: 100 }))
      .resolves.toMatchObject({
        items: [
          { path: '.cmasterignore', mediaType: 'text/plain' },
          { path: 'README.md', mediaType: 'text/markdown' },
          { path: 'src/app.ts', mediaType: 'text/plain' },
        ],
      });
    const firstPage = await files.listFiles(owner.resolveRequest(), scope, { limit: 1 });
    expect(firstPage.items).toMatchObject([{ path: '.cmasterignore' }]);
    expect(firstPage.nextCursor).toBeTypeOf('string');
    if (!firstPage.nextCursor) throw new Error('Expected another file page');
    await expect(files.listFiles(owner.resolveRequest(), scope, {
      limit: 1, cursor: firstPage.nextCursor,
    })).resolves.toMatchObject({ items: [{ path: 'README.md' }] });
    await expect(files.listFiles(owner.resolveRequest(), scope, {
      limit: 20, cursor: 'not-a-cursor',
    })).rejects.toBeInstanceOf(InvalidWorkspaceCursorError);
    await expect(files.searchFiles(owner.resolveRequest(), scope, {
      query: '\n', limit: 20,
    })).rejects.toBeInstanceOf(InvalidWorkspaceFileQueryError);
    await expect(files.openFile(owner.resolveRequest(), {
      ...scope, revisionId: workspaceRevisionId(randomUUID()), path: 'src/app.ts',
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);

    await expect(files.openFile(owner.resolveRequest(), { ...scope, path: 'src/app.ts' }))
      .resolves.toMatchObject({
        path: 'src/app.ts',
        encoding: 'utf8',
        content: expect.stringContaining('searchable = "needle needle"'),
      });
    const firstSearch = await files.searchFiles(owner.resolveRequest(), scope, {
      query: 'needle', limit: 1,
    });
    expect(firstSearch).toMatchObject({
      items: [{ path: 'src/app.ts', line: 2, column: 28 }],
    });
    expect(firstSearch.nextCursor).toBeTypeOf('string');
    if (!firstSearch.nextCursor) throw new Error('Expected another search page');
    await expect(files.searchFiles(owner.resolveRequest(), scope, {
      query: 'needle', limit: 1, cursor: firstSearch.nextCursor,
    })).resolves.toMatchObject({
      items: [{ path: 'src/app.ts', line: 2, column: 35 }],
    });
    await expect(files.openFile(owner.resolveRequest(), { ...scope, path: 'ignored.txt' }))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(files.listFiles(colleague.resolveRequest(), scope, { limit: 100 }))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);

    await writeFile(join(fixture.checkout, 'src', 'app.ts'), 'export const changed = true;\n');
    await run('git', ['-C', fixture.checkout, 'commit', '-am', 'changed later']);
    await run('git', ['-C', fixture.checkout, 'push']);
    await expect(new PostgresWorkspaceWorkingRoots(pool, {
      revisionContent: createConfiguredWorkspaceRevisionContentReader({ storageRoot }),
    }).openFile(owner.resolveRequest(), { ...scope, path: 'src/app.ts' }))
      .resolves.toMatchObject({
        content: expect.stringContaining('searchable = "needle needle"'),
      });
  });

  it('returns one stable empty page for an exact empty Workspace Revision', async () => {
    const created = await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Empty files',
        operationMode: 'observe',
      },
    );
    const root = created.value.defaultWorkingRoot;
    if (!root) throw new Error('Expected empty Workspace root');
    const files = new PostgresWorkspaceWorkingRoots(pool, {
      revisionContent: createConfiguredWorkspaceRevisionContentReader({
        storageRoot: join(fixtureRoot, 'empty-content'),
      }),
    });
    await expect(files.listFiles(owner.resolveRequest(), {
      workspaceId: created.value.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    }, { limit: 20 })).resolves.toEqual({ items: [] });
  });
});
