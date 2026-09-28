# ADR-0048: Use private internal Git refs for applied Workspace Revisions

- Status: Accepted
- Date: 2026-03-22

## Context

Applying a Workspace Change Set must create an immutable Workspace Revision without also performing the separately governed Git Commit operation. Rebuilding a Git-backed Revision from the governed readable-file projection would silently discard ignored, binary, oversized, symlink, or otherwise unsupported repository entries. Updating a branch or Worktree during apply would instead collapse Apply and Git Commit into one side effect.

## Decision

For a Git-backed Working Root, Change Set apply uses a private Git index rooted at the current immutable commit, writes only validated changed blobs, and creates a deterministic commit object. It retains that object under the server-owned `refs/cmaster/revisions/<revisionId>` namespace, but does not update an Employee branch, tag, remote, or materialized Git Worktree. The resulting Workspace Revision records `content_kind = git_snapshot` and its object ID.

The private ref is an internal content-addressed Workspace snapshot and retention root, not the product-level Git Commit operation. A future governed Commit command remains responsible for updating the intended Employee Git ref and producing its own Command, Tool Call, Approval, receipt, and audit facts.

Empty and non-Git Working Roots use the shared Workspace Content Storage snapshot Adapter. Both forms preserve bytes that are not visible through governed reads. Revision reads continue to apply `.cmasterignore`, and Git snapshots additionally retain applicable `.gitignore` behavior.

## Consequences

- Change Set apply preserves the complete Git tree while Employee branch refs remain unchanged.
- Apply, Commit, Push, PR, and Merge retain separate side-effect and recovery identities.
- Private Revision refs prevent ordinary Git garbage collection from deleting authoritative Workspace content; Workspace retention must eventually remove them explicitly.
- Adapters and diagnostics must continue to hide object-store paths and internal object identifiers from Browser Contracts and Model-facing Tool output.
