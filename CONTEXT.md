# CMaster Bot

CMaster Bot is an enterprise-provided assistant that helps employees complete workplace tasks through conversations, delegated agents, and governed enterprise capabilities.

## Language

**Enterprise Assistant**:
An assistant provided and governed by an enterprise for employees to complete workplace tasks.
_Avoid_: Personal assistant, desktop assistant, generic chatbot

**Organization**:
The enterprise data, policy, and administrative isolation scope within which the Enterprise Assistant operates. An Organization may contain multiple Workspaces.
_Avoid_: Tenant account, Workspace

**Workspace**:
A private, filesystem-rooted work and authority boundary owned by one Employee Principal under an Organization and selected before a Conversation begins. It may contain many Conversations, optionally bind one Git Repository, and expose multiple isolated Git Worktrees; it does not support cross-Principal sharing and cannot expand its owner's existing authority.
_Avoid_: Employee Experience, Organization, Organization shared team space, unbounded filesystem access, project label

**Repository Binding**:
The governed association between one Workspace and at most one Git Repository source, including the authority needed for controlled fetch and push operations. It is not a credential embedded in Workspace Files.
_Avoid_: Git Worktree, Connector credential, arbitrary clone URL

**Git Worktree**:
An isolated working directory and Branch of a Workspace's bound Git Repository. A Git Workspace may contain multiple Worktrees, but each Conversation is fixed to exactly one of them and a Run cannot modify more than one.
_Avoid_: Workspace, Repository Binding, cross-Worktree Run

**Workspace File**:
A mutable file within one Workspace's filesystem root that serves as working material for its Conversations and Runs. It is distinct from an immutable Artifact Version and becomes a durable work output only through an explicit publication.
_Avoid_: Artifact Version, Message attachment, unrestricted host file

**Workspace Operation Mode**:
A Workspace-level restriction on how its Agent Runs may interact with Workspace Files. Observe permits reads only, Edit with Confirmation requires approval before a proposed write is applied, and Trusted Automation permits policy-bounded writes without per-change approval; no mode can exceed the owning Principal's authority or the Workspace root.
_Avoid_: Principal Entitlement, Tool Grant, unrestricted filesystem permission

**Workspace Revision**:
An immutable identity for one consistent state of a Git Worktree or an empty Workspace's working directory. A Run pins the Revision it reads and advances only through an explicit recorded transition after applying a compatible Workspace Change Set.
_Avoid_: Git Commit, Artifact Version, floating latest files

**Workspace Change Set**:
An immutable proposal from one Run to create, modify, move, or delete a bounded set of Workspace Files against an identified Workspace Revision. It is approved or rejected as a whole; requesting an adjustment creates a new Change Set, and a stale overlapping proposal conflicts rather than blindly overwriting current files.
_Avoid_: Applied file mutation, editable approval form, Artifact Version, Git commit

**Principal**:
An authenticated human or system identity to which organizational permissions can be assigned.
_Avoid_: Agent, session user

**Employee**:
A human Principal who uses the Enterprise Assistant under an Organization's identity and policies.
_Avoid_: Consumer, local user

**Service Principal**:
A non-human Principal that owns scheduled or system-initiated work under explicit organizational permissions.
_Avoid_: Agent, system user

**Principal Entitlement**:
An enterprise-authorized capability assigned to a Principal and supplied as an input to Policy evaluation. It is distinct from an Agent's Tool Grant and from permissions enforced by an external target system.
_Avoid_: Tool Grant, Agent capability, Provider credential

**Delegation**:
The constrained authority passed from a Principal through an Agent Invocation to a child Invocation; delegation may preserve or reduce authority but never expand it.
_Avoid_: Impersonation, role inheritance

**Approval Subject**:
An immutable governed action or request to which an approval decision applies. Changing the action, input, or authority context creates a new Approval Subject.
_Avoid_: Editable approval form, reusable permission

**Approval**:
An auditable approval or rejection of one immutable Approval Subject that satisfies a Policy obligation. It does not change the Subject or grant reusable authority.
_Avoid_: Tool Grant, permission, parameter editing

**Tool Approval**:
A one-time Approval whose Subject is one exact Tool operation request, including its Tool identity and version, input, and authority context. A new or changed request requires a new Tool Approval.
_Avoid_: Tool permission, Run-wide approval, approval session

**Employee Confirmation**:
An Approval resolved by the initiating Employee to affirm the intent to perform its exact immutable Subject. It satisfies a confirmation obligation but cannot authorize an action the Employee was not already allowed to request.
_Avoid_: Manager approval, four-eyes approval, privilege grant

**Policy Decision**:
A versioned allow or deny result for one governed action and authority context, with safe reason codes and any obligations that must be satisfied before execution. An obligation adds controls but never turns a denied action into an allowed one.
_Avoid_: Authentication claim, Tool Grant, mutable rule configuration

## Conversations and Execution

**Conversation**:
A continuing employee-visible exchange within exactly one Workspace that contains an ordered history of Messages. In a Git-backed Workspace it is also fixed to exactly one Git Worktree; it is not an execution lifecycle and inherits the private owner boundary of its Workspace.
_Avoid_: Chat session, thread session, Workspace, cross-Worktree session, Organization-wide chat

**Message**:
An immutable employee-visible item in a Conversation, authored by an employee or the Enterprise Assistant.
_Avoid_: Run output, event

**Run**:
One complete attempt to fulfill a work request authorized by a Principal, from acceptance through a terminal outcome. A Run may be associated with a Conversation, Task, automation trigger, or parent Run.
_Avoid_: Session, request

**Trigger**:
The recorded origin of a Run, such as a Message, Task, webhook event, schedule, API request, or parent Run.
_Avoid_: Transport request, Invocation

**Invocation**:
One Agent's participation within a Run. Invocations form a parent-child tree when work is delegated.
_Avoid_: Worker session, harness session

**Interrupt**:
A durable pause in a Run while it waits for an external response to a specific request. An unresolved Interrupt outlives Browser connections and Worker leases; resolving it allows execution to resume from a safe checkpoint.
_Avoid_: UI modal, Worker sleep, stream disconnection

**Waiting Run**:
A non-terminal Run paused by an unresolved Interrupt, with no Agent actively executing. It remains cancellable and may return to execution after the Interrupt is resolved.
_Avoid_: Running Run, failed Run, blocked Worker

**Plan**:
A temporary proposed sequence of work within a Run's Working State. Plan steps become Tasks only through an explicit promotion decision.
_Avoid_: Workflow, Task DAG

**Task**:
A durable unit of work that requires an identity and lifecycle beyond one synchronous Run, such as queued, dependent, assigned, retried, or background work.
_Avoid_: Every tool call, Plan step

**Workflow**:
A reusable, versioned definition of steps, conditions, dependencies, and input/output flow for automation.
_Avoid_: Plan, Run, DAG

**Workflow Execution**:
One execution of a published Workflow Revision, coordinating durable Tasks and their attempts.
_Avoid_: Run, Agent Invocation

**Runbook**:
An operational Workflow with explicit risk, approval, evidence, and rollback expectations.
_Avoid_: Separate workflow engine, shell script

**Engine Session**:
A provider-specific continuation identity used by an Agent Engine. It is not a Conversation or Run identity.
_Avoid_: Session

## Agents and Execution Control

**Agent**:
A named, governed role that participates in a Run through an Invocation and is configured with instructions and capabilities.
_Avoid_: Worker, bot instance

**Agent Revision**:
An immutable, published version of an Agent's instructions, capability requirements, grants, and execution policies. Each Run pins the Revision it uses.
_Avoid_: Agent instance, Run version, draft configuration

**Eval Suite**:
A versioned collection of cases used to measure regression, capability, safety, cost, or performance of an Agent, Model, Tool, Skill, or policy change.
_Avoid_: Unit test suite, production monitoring

**Eval Evidence**:
The recorded result and provenance of running an Eval Suite against specific versioned inputs and candidate Revisions.
_Avoid_: Grader output, user feedback

**Harness**:
The provider-neutral execution control system that governs Runs and Invocations, including lifecycle, limits, policy decisions, interruption, and outcome handling.
_Avoid_: Agent loop, model adapter, session manager

**Agent Engine**:
The execution mechanism an Agent uses to reason and produce actions within an Invocation.
_Avoid_: Model provider, Harness

**Model Profile**:
An enterprise-approved model choice described by its capabilities, limits, cost class, and data-handling policy.
_Avoid_: Provider, Agent Engine

**Model Provider**:
An external or enterprise-hosted system through which Models are accessed.
_Avoid_: Model, Agent Engine

## Skills and Tools

**Skill**:
An installable, versioned capability package containing instructions or resources and optionally contributing Tools.
_Avoid_: Tool, plugin

**Tool**:
An atomic operation an Agent may invoke through a stable identity and an input/output contract.
_Avoid_: Skill, Connector, MCP server

**Tool Capability**:
A stable Tool identity and major input/output contract that an Agent may be granted. Compatible implementation changes do not create a new Capability; broader operations, authority, credential scope, or data access do.
_Avoid_: Tool implementation, Provider endpoint, unversioned action name

**Tool Revision**:
An immutable, reviewed realization of a Tool Capability with a concrete Provider binding and declared effect, recovery, and risk characteristics. An Invocation resolves granted Capabilities to exact Revisions and keeps them fixed through recovery.
_Avoid_: Dynamic Provider metadata, mutable Tool configuration, Agent grant

**Tool Grant**:
An Agent Revision's permission to request a specific Tool Capability. It does not authorize every Principal or bypass runtime Policy and Employee Confirmation.
_Avoid_: Tool Revision pin, Credential, unconditional execution permission

**Model Tool Request**:
A candidate Tool operation proposed by a Model from the Tools made available to it. It carries no execution authority and becomes a Tool Call only after Tool Runtime validation, authorization, and durable acceptance.
_Avoid_: Tool Call, Tool Grant, Provider dispatch

**Tool Call**:
One immutable request accepted by Tool Runtime for an Invocation to execute a specific Tool Revision with fixed input and authority context. Its durable lifecycle records policy, confirmation, dispatch, and outcome without promising exactly-once external effects.
_Avoid_: Model Tool Request, Tool, retry attempt

**Tool Outcome**:
The normalized result of one Tool Call, including success, denial, classified failure, or uncertain external effect. It is safe to pass across Module seams and never exposes credentials or raw Provider errors.
_Avoid_: Provider response, thrown exception, Run result

**Uncertain Tool Outcome**:
A Tool Outcome for which the external effect may have occurred but cannot yet be proven. It remains an immutable audit fact; an Employee may continue with that uncertainty or cancel the Run, but cannot relabel it as success or failure without external evidence.
_Avoid_: Failed Tool Call, retry permission, manually confirmed success

**Connector**:
A configured connection to an enterprise system that may contribute one or more Tools.
_Avoid_: Tool, integration action

**Tool Provider**:
A source that contributes and executes Tools, regardless of whether it uses local code, MCP, a Connector, or a remote system.
_Avoid_: Skill, Tool

**Tool Catalog**:
The authoritative inventory of available Tool identities, contracts, versions, and availability.
_Avoid_: Tool Runtime, Skill Registry

**Tool Runtime**:
The governed execution system through which Agents discover permitted Tools and invoke them without knowing their Provider.
_Avoid_: Tool Catalog, Skill installer

## Events and Presentation

**Run Event**:
An ordered, versioned fact about a Run or Invocation lifecycle that can be persisted and replayed.
_Avoid_: UI event, token delta, ExecutionStep

**Output Delta**:
A transient increment of generated output streamed while an Invocation is active; it is not necessarily retained as an individual Run Event.
_Avoid_: Message, Run Event

**Working State**:
Temporary structured state used to coordinate one Run, such as plans, variables, intermediate results, and checkpoints.
_Avoid_: Conversation history, Memory

**Memory**:
Recallable information retained from prior interactions or outcomes for an Employee, Agent, or Organization; it is not an authoritative enterprise fact by default.
_Avoid_: Conversation history, Knowledge, context

**Knowledge**:
Governed enterprise information with provenance, version, and access scope.
_Avoid_: Memory, model context

**Invocation Context**:
The temporary, policy-filtered projection of Messages, Working State, Memory, Knowledge, Skill content, Artifacts, and Agent instructions selected for one Invocation.
_Avoid_: Conversation history, Context Snapshot

**Context Summary**:
A derived, lossy compression of an identified span of source content for use in an Invocation Context. It does not replace Messages and is not Memory or Knowledge.
_Avoid_: Conversation summary, Memory, authoritative history

**UI Projection**:
A presentation-oriented view derived from Run Events, Output Deltas, and other canonical records for a particular employee experience.
_Avoid_: Domain model, event store

**Diagnostic Trace**:
A restricted, policy-governed diagnostic record supplied by an Engine or Model for authorized analysis and never treated as employee-visible reasoning or a business fact.
_Avoid_: Run Event, reasoning UI, audit log

## User Experiences

**Employee Experience**:
The employee-facing experience organized around Workspaces, Conversations, Tasks, approvals, and work outputs rather than platform internals.
_Avoid_: Workspace, Admin Console, feature dashboard

**Admin Console**:
The governed administrative experience for configuring and operating Agents, Tools, Models, policies, automation, and platform oversight.
_Avoid_: Employee Experience, employee settings

**Artifact**:
A durable, versioned work output produced or used by a Run and fixed to one Workspace, such as a document, table, chart, file, workflow, or code bundle. It may retain provenance to a source Worktree, Workspace Revision, and path but survives Worktree deletion; use in another Workspace requires an explicit governed copy that creates a distinct Artifact.
_Avoid_: Workspace File, cross-Workspace shared file, attachment, tool result, message part

**Artifact Reference**:
A stable reference to one exact Artifact Version without embedding its content or storage location.
_Avoid_: Attachment payload, latest-version link, storage key
