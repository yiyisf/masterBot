# Legacy Freeze and Replacement Inventory

ADR-0042 freezes the prototype implementation while the next architecture is built.

## Read-only reference trees

```text
src/
tests/
web/
skills/
agents/
```

New code under `apps/`, `packages/`, `tooling/`, and `infra/` must not import from those trees. Reuse means copying the relevant behavior, adapting it to the accepted Module interface, and protecting it with new tests.

## Exceptions

Only urgent security or data-integrity defects may modify frozen paths, through a dedicated `legacy-fix/*` branch and PR. Routine cleanup, features, and refactors go to the next architecture.

## Replacement inventory

| Legacy area | Target Module/App | Planned Slice | Status |
|---|---|---:|---|
| `src/gateway`, old API/SSE | `apps/server`, `packages/execution` | 1 | Run Walking Skeleton started; legacy not yet replaced |
| `src/core/agent*`, `src/core/harness` | `packages/execution`, Engine adapters | 1–2 | Echo Engine foundation started; legacy not yet replaced |
| `src/llm` | `packages/models` | 2 | Not started |
| `src/skills`, `skills/` | `packages/tools`, Provider Host | 3 | Not started |
| `src/memory`, context manager | `packages/context` | 4 | Not started |
| attachments and generated outputs | `packages/artifacts` | 4 | Not started |
| `web/` | `apps/web` | 5 | Minimal Employee Workspace started; legacy not yet replaced |
| task DAG/workflow/runbook | `packages/automation` | Later | Not started |

Update this table only when a Slice PR establishes or retires a replacement path.
