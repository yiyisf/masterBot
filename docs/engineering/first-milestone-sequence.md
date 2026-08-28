# First milestone implementation sequence

> 规范性详细计划见 [`docs/architecture/refactor-plan.md`](../architecture/refactor-plan.md)。本文件是分支顺序速查。

Each slice starts from the latest `master`, uses a short-lived branch, remains disabled until usable, and merges only through a reviewed pull request with its own acceptance path.

1. **`refactor/workspace-foundation`** — npm Workspaces, module exports and dependency checks, PostgreSQL test environment, generated contracts, CI, and feature-flag foundation without bulk code movement.
2. **`refactor/run-walking-skeleton`** — development identity, Conversation and Message, Run command, PostgreSQL dispatch, Worker, fake Agent Engine, ordered Run Events, replayable SSE, and a minimal Web projection.
3. **`refactor/ai-sdk-runtime`** — Model Catalog, Router and Gateway, Vercel AI SDK model and Agent Engine adapters, normalized usage and telemetry, constrained fallback, and smoke evaluations.
4. **`refactor/tool-runtime`** — Tool Catalog and Runtime, AI SDK Tool wrappers, baseline Policy Module, Tool-call ledger, approval interrupts, a small built-in Tool set, and isolated Provider-host skeleton.
5. **`refactor/context-artifacts`** — Context Builder and Manifest, Conversation-history policy, Artifact Module, local content-addressed adapter, and Artifact renderer registry.
6. **`refactor/employee-workspace`** — complete Conversation experience, Run timeline, Invocation and Tool detail, approvals, Artifacts, SSE recovery, design-system baseline, and core responsive behavior.
7. **`refactor/production-starter`** — internal OIDC adapter, API/Worker runtime packaging, PostgreSQL and Artifact backup/restore, audit and OTel export, security and rate limits, deployment documentation, end-to-end tests, evaluations, and canary acceptance.

Later slices add Agent administration and Revisions, Agent Skills and Skill Catalog, Memory and Knowledge, Tasks and Workflows, enterprise credential providers, more Agent Engines, and the HA deployment profile.
