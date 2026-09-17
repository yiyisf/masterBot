# Filesystem Workspace foundation and trusted Git provisioning

Slices 6.1–6.3a expose the authoritative Workspace backend behind:

```text
NEXT_ARCHITECTURE_ENABLED=true
CMASTER_FILESYSTEM_WORKSPACE_ENABLED=true
CMASTER_WORKSPACE_STORAGE_ROOT=data/workspaces
CMASTER_GIT_REPOSITORIES_JSON=[]
```

The Filesystem Workspace flag requires the next architecture. It remains independent of the historical `CMASTER_EMPLOYEE_WORKSPACE_ENABLED` flag; the existing Employee Experience is unchanged while the new backend is incomplete.

`CMASTER_WORKSPACE_STORAGE_ROOT` must be durable shared storage visible at the same path to every Workspace Worker. Worker-local checkout storage is not authoritative and is not a supported deployment.

## Trusted Repository configuration

The Browser never submits a clone URL or server path. Operators configure the trusted mapping as JSON:

```json
[
  {
    "connectorId": "00000000-0000-4000-8000-000000000101",
    "repositoryId": "00000000-0000-4000-8000-000000000102",
    "remoteUrl": "https://git.example.internal/product/repository.git"
  }
]
```

Only credential-free `https`, `http`, `ssh`, and `file` URLs are accepted in this server configuration. Production authentication must be supplied by an operation-scoped `WorkspaceGitCredentialBroker`; credential values must not be placed in this JSON. The Git Adapter leases a credential only for the child process, uses `GIT_ASKPASS`, and revokes the lease afterward. Credentials are not written to PostgreSQL, Workspace content, Contracts, errors, or logs.

## Delivered boundary

`@cmaster/workspaces` owns:

- Principal-private empty and trusted-Git Workspace provisioning;
- stable default Working Roots and immutable Workspace Revisions;
- one Repository Binding per Git Workspace;
- multiple isolated Git Worktrees from a pinned base commit;
- Worktree archive lifecycle without deleting Git history;
- Operation Mode and Workspace archive/restore lifecycle;
- operation-specific idempotency receipts and reconciliation;
- durable operations, outbox records, Worker leases, expired-lease recovery, and safe structured failures;
- bounded opaque-cursor Workspace, Worktree, and fixed-Revision file pagination;
- exact-Revision text file list/search/open backed by persisted safe metadata;
- mandatory `.cmasterignore` and applicable `.gitignore` filtering;
- denial of traversal, symbolic links, Gitlinks/nested repositories, binary files, and oversized content.

PostgreSQL and shared Workspace Content Storage are authoritative. Git provisioning is accepted transactionally before any Git I/O. The `api` role only accepts and reads Commands; the `worker` or `all` role materializes repositories and Worktrees. A Worker restart can reclaim an expired lease, and operation-scoped content receipts prevent a completed Git side effect from being repeated after response loss.

Public routes:

```text
POST /api/v1/workspaces
GET  /api/v1/workspaces
GET  /api/v1/workspaces/by-command/{commandId}
GET  /api/v1/workspaces/{workspaceId}
POST /api/v1/workspaces/{workspaceId}/archive
POST /api/v1/workspaces/{workspaceId}/restore
GET  /api/v1/workspaces/{workspaceId}/lifecycle-commands/{commandId}

GET  /api/v1/workspaces/{workspaceId}/worktrees
POST /api/v1/workspaces/{workspaceId}/worktrees
GET  /api/v1/workspaces/{workspaceId}/worktree-commands/{commandId}
POST /api/v1/workspaces/{workspaceId}/worktrees/{worktreeId}/archive
GET  /api/v1/workspaces/{workspaceId}/worktrees/{worktreeId}/lifecycle-commands/{commandId}

GET  /api/v1/workspaces/{workspaceId}/working-roots/{workingRootId}/revisions/{revisionId}/files
GET  /api/v1/workspaces/{workspaceId}/working-roots/{workingRootId}/revisions/{revisionId}/files/open
GET  /api/v1/workspaces/{workspaceId}/working-roots/{workingRootId}/revisions/{revisionId}/files/search
```

Commands require an `Idempotency-Key` UUID. Repeating the same operation-specific Command with the same normalized request returns `Idempotency-Replayed: true`; key reuse with another request returns 409. Reconciliation returns current authoritative state. Unknown, cross-Organization, and cross-Principal reads/transitions return the same 404 representation apart from the request-specific `instance` URI.

## Operational behavior

A Git Workspace is initially `provisioning`. Successful materialization creates its default Git Worktree and Revision and transitions it to `ready`. Failure transitions it to `failed` with only a safe code and retryability flag. Raw Git output, remote URLs, paths, and credentials are never returned.

Additional Worktrees are asynchronous. Their Command first returns a `pending` operation; clients reconcile the operation until `succeeded` or `failed`, then refresh the bounded Worktree list. Branch names are validated by both the Module and Git. Active branch names are unique within a Workspace. The default Worktree cannot be archived.

File reads always identify an exact Workspace, Working Root, and immutable Revision. The first authorized read builds a bounded safe metadata index from the pinned Git commit (or the canonical empty Revision), then persists only relative path, media type, byte size, and SHA-256. Content remains in shared Workspace storage and is revalidated against metadata when opened. Only canonical UTF-8 regular files up to 1 MiB are readable. Search is literal, case-sensitive, and bounded to 1,000 files / 8 MiB per request. Ignored and unsupported entries are absent rather than exposing host or Git details.

## Explicitly absent

This slice does not add Sandbox execution, governed file Tools, Invocation temp/overlay, Change Sets, Conversation/Run/Artifact Workspace scope, Git commit/push/PR/merge delivery, Pending composition, Worktree deletion, or the replacement Employee Experience.

## Verification

```bash
npm run next:check
DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next \
  npm run next:test:integration
```
