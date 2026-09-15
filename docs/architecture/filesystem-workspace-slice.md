# Filesystem Workspace Slice

> **Status: Accepted design; sequential implementation authorized.**
>
> Detailed product and interaction record: [`docs/design/filesystem-workspace.html`](../design/filesystem-workspace.html).

## Outcome

Replace the Workspace-less Slice 5 employee shell with a Web-first Employee Experience in which an Employee Principal selects a private, server-managed filesystem Workspace and one Working Root before creating a Conversation. Runs pin a Workspace Revision, operate in an isolated Sandbox, and route every file write through a Workspace Change Set.

This is a complete product Slice, not a UI-only rewrite. Production UI must not imply Workspace authority until the Workspaces Module, Sandbox, persistence, and versioned Contracts are authoritative.

## Constraints and dependency categories

- **Authority:** trusted Organization/Principal context, current Workspace mode, Agent grant, Policy, and Delegation intersect; Browser scope is never authoritative.
- **Durable state:** PostgreSQL stores identities/transitions; Workspace Content Storage stores revision content; neither Worker-local disk nor a Git checkout is the System of Record.
- **External effects:** clone/fetch/push/PR/merge, Credential leases, and network access can fail with unknown outcome and require operation receipts/reconciliation.
- **Execution:** Sandbox materialization is recoverable on another Worker; mutating tools write an Invocation-private overlay, never the shared root.
- **Consistency:** one apply transition creates each Revision; at-least-once delivery and response loss must converge by stable Command identity and request hash.
- **Experience:** REST Commands plus recoverable SSE, bounded projections, exact scope in URLs, mobile/desktop accessibility, and safe unknown-type fallback remain mandatory.

## Interface design alternatives

The design was explored three ways before selecting the public seam:

1. **Storage-shaped repositories** — expose Workspace, Worktree, Revision, File, and Change Set repositories separately. It is initially familiar but shallow: every caller must coordinate Git, storage, concurrency, policy timing, and recovery. Rejected because it leaks decisions and creates multiple write paths.
2. **One generic capability lease** — expose only `acquireWorkspaceCapability(scope, operations)` and let Tools perform all filesystem/Git work. It is narrow but makes lifecycle, immutable Change Sets, conflict results, and Employee queries implicit protocol. Rejected because the important domain invariants disappear into untyped capability payloads.
3. **Cohesive Workspaces Module surfaces** — expose Catalog, Working Roots, Changes, and Run Environments while keeping Git/content/Sandbox adapters internal. Selected because callers express product intents, Workspaces owns cross-adapter consistency, and each caller can import only the surface it needs.

The selected design is deeper than a set of CRUD repositories but avoids one unstructured “god method.” It also preserves replacement seams only where there are real implementations: PostgreSQL/test persistence, durable/test content stores, Git/deterministic fixtures, and production/test Sandboxes.

## Stable seams

### Workspaces Module

`packages/workspaces` owns Workspace, Repository Binding, Git Worktree, Workspace Revision, Workspace File metadata, Workspace Change Set, Workspace Operation Mode, provisioning, archive/delete state, and content materialization. Its package-root Interface hides paths, Git implementation, content layout, optimistic concurrency, and Sandbox preparation.

Callers need four cohesive capabilities rather than storage-shaped repositories:

- **Catalog** — provision empty/Git Workspaces, list/get private Workspaces, archive/restore/delete, resolve allowed/default Agents.
- **Working Roots** — list/create/archive Worktrees, inspect bounded file trees, open safe file content, resolve immutable Revisions.
- **Changes** — propose, resolve, apply, and query immutable Change Sets with conflict results and idempotent Command identities.
- **Run Environment** — prepare/release an isolated environment for one Workspace/Working Root/Revision under one effective Operation Mode.

Git and Workspace Content Storage are internal Adapter seams because production and deterministic test implementations both exist. The external Module Interface never exposes absolute host paths, Git library types, storage keys, container types, or database rows.

### Existing Module relationships

- Conversations validates Workspace/Working Root authority through the Workspaces Interface and persists their stable IDs; it never reads Workspace tables or files.
- Execution pins Workspace, Working Root, base Workspace Revision, Run maximum Operation Mode, Agent Revision, and Policy versions; it asks Workspaces to prepare an environment and never manages Git.
- Tools receives bounded file capabilities from the prepared Run environment; Built-in and extension Tools cannot bypass it.
- Context records exact Workspace File/Revision sources selected through governed read capabilities; it does not own files.
- Governance owns Policy Decisions and immutable Approval Subjects for Change Set, Commit, Push, PR, and Merge operations; Workspaces applies approved transitions.
- Artifacts publishes an immutable Workspace-scoped Artifact Version from an authorized exact file Revision and retains provenance without owning Workspace Files.
- The Server Experience Adapter composes bounded projections only through package-root Interfaces.

## Delivery sequence

Each item is one blockers-first vertical ticket or the smallest set of independently reviewable tickets. Every implementation branch starts from current `master`; no long-lived integration branch and no permanent dual write are allowed.

### 1. Workspace foundation

- Add `packages/workspaces` and its package-root public Interface.
- Add PostgreSQL ownership for private Workspace metadata, default Working Root, Operation Mode, Revision, operation receipts, and outbox state.
- Add shared durable Workspace Content Storage with a deterministic test Adapter.
- Deliver empty Workspace provision/list/get/archive/restore through versioned Contracts.
- Keep all routes behind one temporary Filesystem Workspace flag.

**Exit:** an Employee can provision and reopen an empty private Workspace after API/Worker restart; another Principal receives indistinguishable not-found behavior.

### 2. Git provisioning and Worktrees

- Add governed Repository Binding through an existing Connector/Credential seam.
- Add asynchronous clone/fetch status and structured failures.
- Add one Repository per Workspace and multiple Git Worktrees.
- Add current Worktree selection plus isolated Worktree creation and lifecycle.
- Reject arbitrary Server paths, nested repositories, and credential persistence in files.

**Exit:** deterministic Git fixtures prove clone, multiple Worktrees, restart recovery, owner privacy, and no second Repository.

### 3. Sandbox and governed reads

- Implement the ADR-0045 Sandbox Adapter with one fixed-Revision Working Root, read-only runtime, Invocation-private temp/overlay, no host paths, and default-denied network.
- Add bounded list/search/read Tool Capabilities.
- Enforce canonical paths, symlink/mount/hook/subprocess escape prevention, file limits, `.cmasterignore`, and applicable `.gitignore` behavior.
- Extend Context Manifest sources with Workspace/Working Root/Revision/file provenance.

**Exit:** a real Worker reads a fixed Revision and recovery on another Worker observes identical content; escape fixtures are denied without leaking host details.

### 4. Change Sets and Operation Modes

- Finalize every mutating Run overlay into an immutable proposal; add approve/reject/request-adjustment/apply transitions so shared content has one write path.
- Implement whole-Change-Set Approval Subjects, stable Command identities, Revision compare-and-apply, compatible non-overlap replay, and explicit conflict.
- Enforce Observe, Edit with Confirmation, and Trusted Automation through one write path.
- Pin Run maximum mode; allow immediate restriction but no in-place elevation.

**Exit:** approval never changes files before commit; Trusted Automation still records and applies a Change Set; stale overlap never overwrites; response loss reconciles one transition.

### 5. Conversation, Run, and Agent scope

- Move new Employee routes to explicit Workspace + Worktree hierarchy.
- Require Workspace/Working Root before Conversation creation.
- Make Conversation immutable in Workspace/Working Root ownership and allow many Conversations per Workspace.
- Pin Run base Revision and selected Agent Revision; support Workspace default/allowed Agents.
- Keep child Agents as child Invocations.

**Exit:** refresh/bookmarks restore exact scope; mismatched route IDs are not-found; concurrent Conversations can read/propose without cross-Worktree access.

### 6. Git delivery operations

- Add explicit governed Commit, Push, Create PR, Merge, conflict-resolution, and Worktree cleanup Commands.
- Keep Apply, Commit, Push, PR, and Merge separate.
- Require confirmation for Push and classify unknown external effects without blind retry.
- Preserve Conversation/Run/Artifact history after Worktree deletion.

**Exit:** deterministic remote fixtures prove idempotency, conflict behavior, uncertain outcome recovery, and no automatic merge/delete.

### 7. Workspace-scoped Artifacts and Pending

- Add `workspaceId` authority to Artifact creation, listing, exact Version reads, and provenance.
- Publish exact Workspace File Revisions; keep mutable files distinct.
- Add explicit governed cross-Workspace copy as a new Artifact identity.
- Compose global Employee Pending grouped by Workspace plus local Workspace Pending.

**Exit:** same-Workspace Conversations share exact Artifact references; cross-Workspace direct reads fail; Worktree deletion does not remove published Artifacts.

### 8. Employee Experience replacement

- Rewrite from the accepted Balanced Workspace A prototype using official AI Elements Registry components, shadcn/ui, Tailwind CSS, and Lucide Icons.
- Deliver Workspace/Worktree switchers, Prompt-first home, Conversation canvas, and persistent Overview/Files/Changes/Artifacts Work Area.
- Consume CMaster View Models and generated Contract clients; do not let `useChat` or AI SDK UI types own Message, Run, Change Set, or Artifact lifecycles.
- Deliver desktop balanced panes and mobile Conversation/Work switch, with `zh-CN`/`en-US`, System/Light/Dark, keyboard, Focus, reduced motion, virtualized long views, and safe fallbacks.

**Exit:** the complete Employee path works with real public seams; no prototype source is promoted directly and no legacy CSS/component path defines the new experience.

### 9. Release and replacement

- Run a production-shaped empty/Git Workspace journey through real Next.js, API, Worker, PostgreSQL, Workspace Content Storage, Sandbox, deterministic Model/Tool/Git Adapters, and exact Artifact consumption.
- Cover response loss, stream gaps, Worker loss, Revision conflict, uncertain Push, unauthorized/mismatched scope, archive/delete, and Worktree history.
- Remove the old `/workspace/*` UI, Workspace-less Browser write path, old feature flag, and tests that assert replaced presentation details.
- Do not migrate prototype or development data.

**Exit:** one authoritative Workspace-aware write path remains and all architecture/release gates pass.

## Explicitly deferred

- Employee-device local directory Companion
- Browser file/directory upload and enterprise-storage import
- Multi-repository or multi-root Workspace
- Cross-Principal Workspace membership or sharing
- Browser text/code editor
- Per-file or per-hunk Change Set approval
- Automatic Commit, Push, Merge, or Worktree deletion
- Advanced binary previews

## Prototype disposition

The approved prototype is primary-source evidence on branch `prototype/workspace-ui-redesign`. It answers the visual question with mocked data and official component sources. Production implementation rewrites the accepted composition through real CMaster Interfaces; the prototype route, switcher, mock state, and losing variants never merge into `master`.
