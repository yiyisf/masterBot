# Append Tool-read provenance to Context Manifests

**Status:** Accepted

## Context

The base Invocation Context is fixed before the Agent Engine starts, but an Agent can later discover and open a Workspace File through a governed Tool. The file cannot be known during base Context selection, while recovery and audit still need the exact Workspace, Working Root, Revision, path, and content hash that became Model-visible through the Tool transcript.

Copying file bodies into the Manifest would duplicate authoritative content and leak sensitive data. Treating Tool output only as an opaque Checkpoint would lose source provenance. Replacing the Context Manifest after every read would also invalidate the stable `contextManifestId` fixed in Checkpoints.

## Decision

A Context Manifest has an immutable base selection and an append-only Tool-read provenance tail for the same Invocation.

- Context Builder fixes Message, Artifact, Summary, policy, budget, and base materialization before Engine execution.
- A successful governed Workspace file open appends one idempotent `workspace_file` item identified by exact Workspace, Working Root, Revision, and canonical path.
- The item stores media type, byte size, and SHA-256, but never file content, host path, storage key, Prompt, or credentials.
- List and search do not append provenance because they do not place complete file content in the Model Tool transcript.
- Existing items are never changed or removed. Reopening the same exact source is an idempotent replay; conflicting metadata is an integrity failure.
- Materializing the base Invocation Context ignores Tool-read items. Provider-neutral Tool output remains in the durable Checkpoint transcript and is not injected a second time.
- `invocation.context_built` reports the fixed base selection. Later Tool-read items are auditable through the Manifest but do not rewrite that historical Event.

## Consequences

The stable Manifest identity survives Worker recovery while recording the actual dynamic sources consumed by the Model. Manifest `itemCount` can increase while an Invocation runs, so callers must not treat the initial Context-built Event count as a final audit count. The append path requires serialization and idempotency by exact source scope. Context remains responsible only for provenance; Workspaces remains responsible for authorization and content integrity, and Tools remains responsible for governed dispatch and durable Tool outcomes.
