# Planned Workspace Modules

Only create a business Module when its Slice introduces a real public interface, behavior, and tests. Empty placeholder packages are deliberately avoided.

| Package | Planned Slice | Responsibility |
|---|---:|---|
| `@cmaster/kernel` | 0 | Minimal `Brand` and `Clock` primitives |
| `@cmaster/contracts` | 0 | Versioned external Zod/OpenAPI contracts and typed client |
| `@cmaster/identity` | 1 | Development Organization, Principal, trusted Request Identity |
| `@cmaster/agents` | 1 | Development Echo Agent and immutable Revision foundation |
| `@cmaster/conversations` | 1 | Conversation and immutable Message behavior |
| `@cmaster/execution` | 1 | Run, Invocation, Run Event, Outbox, Lease, Echo/AI SDK Engines, durable output generations |
| `@cmaster/models` | 2 | Immutable Model Profiles, ModelCall audit, OpenAI-compatible Gateway, usage, fallback, telemetry |
| `@cmaster/tools` | 3 | Skill, Tool catalog/runtime, Provider host |
| `@cmaster/context` | 4 | Context Builder, Manifest, Memory/Knowledge access |
| `@cmaster/artifacts` | 4 | Artifact metadata, versions, content storage |
| `@cmaster/automation` | Later | Task, Workflow, Runbook, triggers |
| `@cmaster/governance` | Later | Policy, approvals, audit, credential references |

Cross-package imports must use the package root. Deep imports and relative traversal into another package are prohibited.
