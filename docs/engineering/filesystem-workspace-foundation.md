# Filesystem Workspace foundation

Slice 6.1 introduces the first authoritative Workspace behavior behind:

```text
CMASTER_FILESYSTEM_WORKSPACE_ENABLED=false
```

The flag requires `NEXT_ARCHITECTURE_ENABLED=true`. It is independent of the historical `CMASTER_EMPLOYEE_WORKSPACE_ENABLED` flag; the existing Employee Experience remains unchanged while the new backend is incomplete.

## Delivered boundary

`@cmaster/workspaces` owns private empty Workspace provisioning, the stable default Working Root, initial empty Workspace Revision, Operation Mode, archive/restore lifecycle, operation receipts, and latest-first bounded pagination. PostgreSQL is authoritative; the initial Revision stores the canonical empty-content manifest hash. Non-empty Workspace Content Storage arrives with governed file materialization rather than adding an unused Blob seam here.

Public routes:

```text
POST /api/v1/workspaces
GET  /api/v1/workspaces
GET  /api/v1/workspaces/by-command/{commandId}
GET  /api/v1/workspaces/{workspaceId}
POST /api/v1/workspaces/{workspaceId}/archive
POST /api/v1/workspaces/{workspaceId}/restore
GET  /api/v1/workspaces/{workspaceId}/lifecycle-commands/{commandId}
```

Commands require an `Idempotency-Key` UUID. A repeated operation-specific Command with the same normalized request returns `Idempotency-Replayed: true` together with the current authoritative Workspace; key reuse with another request returns 409. Provision and lifecycle reconciliation remain separate and likewise return current authoritative state. Unknown, cross-Organization, and cross-Principal reads/transitions return the same 404 representation apart from the request-specific `instance` URI.

## Explicitly absent

Git provisioning, non-empty file reads/writes, Sandbox, Change Sets, Conversation/Run/Artifact scope, Pending composition, and the replacement Employee Experience are not simulated by this foundation.

## Verification

```bash
npm run next:check
DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next \
  npm run next:test:integration
```
