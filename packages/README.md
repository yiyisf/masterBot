# Planned Workspace Modules

Only create a business Module when its Slice introduces a real public interface, behavior, and tests. Empty placeholder packages are deliberately avoided.

| Package | Planned Slice | Responsibility |
|---|---:|---|
| `@cmaster/kernel` | 0 | Minimal `Brand` and `Clock` primitives |
| `@cmaster/contracts` | 0 | Versioned external Zod/OpenAPI contracts and typed client |
| `@cmaster/conversations` | 1 | Conversation and Message behavior |
| `@cmaster/execution` | 1 | Run, Invocation, Harness, events, checkpoints |
| `@cmaster/models` | 2 | Model catalog, routing, gateway, usage |
| `@cmaster/tools` | 3 | Skill, Tool catalog/runtime, Provider host |
| `@cmaster/context` | 4 | Context Builder, Manifest, Memory/Knowledge access |
| `@cmaster/artifacts` | 4 | Artifact metadata, versions, content storage |
| `@cmaster/identity` | Later | Organization, Principal, external identity mapping |
| `@cmaster/agents` | Later | Agent identity, immutable Revision, publication |
| `@cmaster/automation` | Later | Task, Workflow, Runbook, triggers |
| `@cmaster/governance` | Later | Policy, approvals, audit, credential references |

Cross-package imports must use the package root. Deep imports and relative traversal into another package are prohibited.
