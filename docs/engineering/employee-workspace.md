# Employee Workspace Slice

Slice 5 replaces the minimal technical Workspace with a Conversation-centric employee experience. The normative self-contained design is [`docs/design/slice-5-employee-workspace.html`](../design/slice-5-employee-workspace.html), and implementation is tracked by [#118](https://github.com/yiyisf/masterBot/issues/118).

## Temporary feature flag

```text
CMASTER_EMPLOYEE_WORKSPACE_ENABLED=false
```

The flag requires Next Architecture, AI SDK Runtime, Tool Runtime, and Context/Artifacts. Invalid enabled combinations fail configuration. While disabled, the Slice 4 minimal Workspace and existing Contracts remain available; the complete Shell and Workspace Projection APIs are not mounted.

This is a migration flag, not a permanent product option. Slice 6 removes all Slice migration flags, disabled replacement paths, and obsolete flag-matrix tests after the Production Starter becomes the single baseline.

## Experience structure

```text
/workspace
/workspace/conversations/new
/workspace/conversations/{conversationId}
/workspace/conversations/{conversationId}/runs/{runId}
/workspace/pending
/workspace/artifacts
/workspace/artifacts/{artifactId}/versions/{artifactVersionId}
```

`/workspace` is an employee home. Conversation is the primary work container; Run Detail is addressable beneath its Conversation. The old top-level `/workspace/runs/{runId}` prototype route is removed without a compatibility contract. `/admin/*` remains a separately mounted, default-disabled shell until trusted roles and real management capabilities exist.

Desktop provides complete navigation, Thread, Composer, Run Detail, pending actions, and Artifact Library. Mobile uses a single-column route model and must support Conversation, Run status/cancel, pending responses, Artifact preview/download, theme, and locale; advanced mobile polish remains deferred.

## Access

Conversation is private to its creating Principal by default. Conversation, Message, associated Run, and Workspace Projection queries derive Organization and Principal from trusted identity. Same-Organization cross-Principal and unknown IDs use the same not-found response. Artifact authorization remains independent. See ADR-0044.

## State ownership

| State | Owner |
|---|---|
| Conversation/Message/Run/Artifact queries | TanStack Query v5 cache |
| Active Run status, Assistant Draft, Timeline, Tool Activity, Interrupt | CMaster Run UI Projection reducer/store |
| Draft, selected panel/tab, local disclosure | React/route state; Draft is temporarily recoverable in `sessionStorage` |

AI Elements + shadcn/ui provide selected presentation source for Conversation, Message, Prompt Input, Tool, and Confirmation. CMaster Feature components own business composition. AI Elements, AI SDK, React, and framework types do not enter Domain, Module Interface, or public CMaster Projection Contracts.

## Run UI Projection

React Features do not consume canonical Run Event names or AI SDK `UIMessageChunk` as the product contract. The Server Presenter maps Run state and canonical events into a versioned Snapshot and sequence stream:

```text
RunUiProjectionSnapshot
├── runId / lastSequence / status / cancellable
├── current Assistant Draft generation and text
├── active Interrupt projection
└── recent bounded Timeline/Tool items

RunUiProjectionEvent
├── schemaVersion / runId / sequence
└── status | draft | timeline | interrupt | message/artifact availability projection
```

The Snapshot is derived on demand in Slice 5; no Projection table is added. Recent Timeline is bounded and older items use sequence pagination. A gap causes Snapshot replacement and reconnect from its `lastSequence`. Only one Workspace UI Stream is active for the selected Run.

Output Delta creates a temporary Assistant Draft. Reset discards the old generation. Only a successfully delivered immutable Assistant Message replaces the Draft in Conversation history; failed/cancelled partial output is not a Message.

## Reliable Composer

The new Conversation route is local until first submit. One logical submit keeps stable idempotency keys while it executes separate Commands:

```text
create Conversation → append Employee Message → create Run
```

Unknown responses are resolved by querying Server facts before resending the same Command ID. A persisted Message with no Run remains visible and can resume Run creation. An explicit Employee “run again” uses a new Command ID and creates another Run attempt for the same Trigger Message; this is distinct from transport recovery.

Within the Employee UI, one Conversation allows one non-terminal Run at a time. This is not a Server Domain invariant: externally created concurrent Runs remain visible. Drafts are stored only in per-tab `sessionStorage`, excluded from Query Cache, logs, telemetry, and Server data, and cleared after successful submission.

## Workspace Query boundaries

Read-only Experience projections are separated by page need rather than one mega DTO:

```text
GET /api/v1/workspace/summary
GET /api/v1/workspace/conversations
GET /api/v1/workspace/conversations/{conversationId}
GET /api/v1/workspace/pending-actions
GET /api/v1/workspace/artifacts
GET /api/v1/workspace/runs/{runId}/projection
GET /api/v1/workspace/runs/{runId}/stream
```

The Server Experience Adapter composes only Module public queries and owns no tables. Commands remain on Conversations/Execution/Artifacts routes. All Browser backend access uses the generated Contract Client. Next.js Server Actions do not create a second business write path.

Browser URLs use same-origin `/api/v1`. Development uses a transparent Next rewrite to the Fastify API; production uses the reverse proxy. `CMASTER_API_ORIGIN` configures only the development rewrite target and defaults to `http://localhost:3100`; `NEXT_PUBLIC_CMASTER_API_URL` stays empty unless an explicit cross-origin test requires it. The rewrite is not a BFF and contains no authorization or business logic.

## Conversation lists

- Conversation title is initialized once from normalized, Unicode-safely bounded first Employee text and can be explicitly renamed without changing Messages.
- Latest 50 Messages load first; older history uses `beforeSequence` and preserves the visual scroll anchor.
- Conversation lists use opaque cursors based on stable recent-activity ordering.
- A bounded plain-text last-Message preview is derived at query time and is not a new persisted fact.
- There is no read receipt, archive, delete, share, folder/tag, export, or server full-text search in Slice 5.

## Pending interactions

“Pending” is a Presentation aggregation of active Interrupts, not a Domain aggregate. It distinguishes Employee Confirmation from Uncertain Tool Outcome Review. The former confirms/rejects one immutable Approval Subject; the latter can only continue with uncertainty and never relabel or retry the Tool effect. Both use existing Run/Interrupt Commands. Cancel uses one accessible confirmation Dialog and does not promise rollback.

## Artifacts

The Library lists only Artifacts readable by the trusted Principal. Every preview/download URL fixes `artifactId + artifactVersionId`; a current version is resolved to an exact ID before navigation. Message cards are compact and do not eagerly fetch content.

Supported inline preview is limited to UTF-8 plain text and Markdown. Raw HTML, scripts, remote images, and dangerous links remain disabled. Other media types use metadata/download Fallback. Preview and download read the same Version; attachment disposition and sanitized filename are controlled by the Server, with `nosniff` and existing single-range behavior.

## Presentation and content design

- AI Elements Registry components remain close to upstream and are adapted through props, classes, CSS variables, semantic tokens, and an external CMaster projection adapter.
- Default `useChat` orchestration does not own Message/Run lifecycle.
- Raw Chain-of-Thought and direct Provider reasoning are never rendered.
- System/Light/Dark and zh-CN/en-US are real acceptance surfaces.
- Copy is concise, natural, concrete, and non-anthropomorphic. It explains what happened, what was saved, and the next action rather than using AI marketing language.

## Accessibility and performance

WCAG 2.2 AA is a merge gate. Core flows are keyboard complete; route/Dialog/Composer focus is deterministic; status is not color-only; stream announcements are throttled; reduced motion is respected. Playwright and axe cover desktop and mobile-core routes.

Performance fixtures cover 1,000 loaded Messages and 2,000 Timeline items. Completed Message rows do not rerender per Output Delta; Draft and Timeline use localized subscriptions; virtualization retains semantic order and focused-item overscan. Production SLOs remain Slice 6 work.

## Safe observability

Slice 5 defines a typed `ClientObservability` seam with a no-op default. It excludes Message/Draft/title/preview, Artifact title/body/hash, Tool input, Approval details, DOM, screenshots, and keystrokes. Slice 6 may send approved metrics through a same-origin intake to an internal OpenTelemetry Collector; Browser never holds Collector credentials, and telemetry failure never changes business behavior.

## Delivery

Slice 5 uses Parent Spec [#118](https://github.com/yiyisf/masterBot/issues/118) and blockers-first short-lived vertical PRs: [#119 private Workspace home](https://github.com/yiyisf/masterBot/issues/119), [#120 reliable Composer](https://github.com/yiyisf/masterBot/issues/120), [#121 continuing Conversations](https://github.com/yiyisf/masterBot/issues/121), [#122 Run UI Projection](https://github.com/yiyisf/masterBot/issues/122), [#123 pending interactions](https://github.com/yiyisf/masterBot/issues/123), [#124 Artifact Library](https://github.com/yiyisf/masterBot/issues/124), [#125 Experience hardening](https://github.com/yiyisf/masterBot/issues/125), and [#126 release gate](https://github.com/yiyisf/masterBot/issues/126). Each PR starts from current `master`, remains isolated by the Slice flag, and proves a public Contract or Browser seam. GitHub native blocking relationships define the implementation frontier; no long-lived integration branch is used.
