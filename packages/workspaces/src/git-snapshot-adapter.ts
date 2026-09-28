import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { OrganizationId } from '@cmaster/identity';
import type { WorkspaceId, WorkspaceRevisionId } from './workspace-types.js';
import { WorkspaceRevisionContentError } from './workspace-types.js';

const executeFile = promisify(execFile);
const gitCommitPattern = /^[0-9a-f]{40,64}$/u;

export type WorkspaceGitSnapshotChange =
  | { readonly kind: 'delete'; readonly path: string }
  | { readonly kind: 'add' | 'modify'; readonly path: string; readonly bytes: Buffer };

export interface WorkspaceGitSnapshotAdapter {
  apply(request: {
    readonly organizationId: OrganizationId;
    readonly workspaceId: WorkspaceId;
    readonly currentCommit: string;
    readonly resultingRevisionId: WorkspaceRevisionId;
    readonly changes: readonly WorkspaceGitSnapshotChange[];
  }): Promise<{ readonly commit: string; readonly contentManifestHash: string }>;
}

const fixedGitEnvironment = {
  GIT_AUTHOR_NAME: 'CMaster Workspace',
  GIT_AUTHOR_EMAIL: 'workspace@cmaster.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'CMaster Workspace',
  GIT_COMMITTER_EMAIL: 'workspace@cmaster.invalid',
  GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
};

export function createConfiguredWorkspaceGitSnapshotAdapter(options: {
  readonly storageRoot: string;
}): WorkspaceGitSnapshotAdapter {
  return {
    async apply(request) {
      if (!gitCommitPattern.test(request.currentCommit)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      const repositoryPath = join(
        options.storageRoot, request.organizationId, request.workspaceId, 'repository.git',
      );
      const staging = join(
        options.storageRoot, request.organizationId, request.workspaceId,
        '.git-snapshot-staging', randomUUID(),
      );
      const indexPath = join(staging, 'index');
      const environment = { ...process.env, ...fixedGitEnvironment, GIT_INDEX_FILE: indexPath };
      try {
        await mkdir(staging, { recursive: true, mode: 0o700 });
        await executeFile('git', ['--git-dir', repositoryPath, 'read-tree', request.currentCommit], {
          env: environment,
        });
        for (const [index, change] of request.changes.entries()) {
          if (change.kind === 'delete') {
            await executeFile('git', [
              '--git-dir', repositoryPath, 'update-index', '--force-remove', '--', change.path,
            ], { env: environment });
            continue;
          }
          const contentPath = join(staging, `content-${index}`);
          await writeFile(contentPath, change.bytes, { flag: 'wx', mode: 0o400 });
          let mode = '100644';
          if (change.kind === 'modify') {
            const { stdout: indexedOutput } = await executeFile('git', [
              '--git-dir', repositoryPath, 'ls-files', '--stage', '--', change.path,
            ], { env: environment, encoding: 'utf8' });
            const indexedMode = indexedOutput.match(/^(100644|100755)\s/u)?.[1];
            if (!indexedMode) {
              throw new WorkspaceRevisionContentError('content_unavailable');
            }
            mode = indexedMode;
          }
          const { stdout: blobOutput } = await executeFile('git', [
            '--git-dir', repositoryPath, 'hash-object', '-w', contentPath,
          ], { env: environment, encoding: 'utf8' });
          const blob = blobOutput.trim();
          if (!gitCommitPattern.test(blob)) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
          await executeFile('git', [
            '--git-dir', repositoryPath, 'update-index', '--add', '--cacheinfo',
            mode, blob, change.path,
          ], { env: environment });
        }
        const { stdout: treeOutput } = await executeFile('git', [
          '--git-dir', repositoryPath, 'write-tree',
        ], { env: environment, encoding: 'utf8' });
        const tree = treeOutput.trim();
        if (!gitCommitPattern.test(tree)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        const { stdout: commitOutput } = await executeFile('git', [
          '--git-dir', repositoryPath, 'commit-tree', tree, '-p', request.currentCommit,
          '-m', `CMaster Workspace Revision ${request.resultingRevisionId}`,
        ], { env: environment, encoding: 'utf8' });
        const commit = commitOutput.trim();
        if (!gitCommitPattern.test(commit)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        const internalRef = `refs/cmaster/revisions/${request.resultingRevisionId}`;
        await executeFile('git', [
          '--git-dir', repositoryPath, 'check-ref-format', internalRef,
        ], { env: environment });
        try {
          await executeFile('git', [
            '--git-dir', repositoryPath, 'update-ref', internalRef, commit, '0'.repeat(commit.length),
          ], { env: environment });
        } catch {
          const { stdout: retainedOutput } = await executeFile('git', [
            '--git-dir', repositoryPath, 'rev-parse', '--verify', internalRef,
          ], { env: environment, encoding: 'utf8' });
          if (retainedOutput.trim() !== commit) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
        }
        return {
          commit,
          contentManifestHash: createHash('sha256').update(tree).digest('hex'),
        };
      } catch (error) {
        if (error instanceof WorkspaceRevisionContentError) throw error;
        throw new WorkspaceRevisionContentError('content_unavailable');
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
  };
}
