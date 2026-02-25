# CMaster Bot — Product Roadmap

## Overview

CMaster Bot is an enterprise-grade, self-evolving AI agent platform built on a ReAct pattern architecture. This roadmap documents completed work through Phase 9 and outlines the path toward a full enterprise feature set.

---

## Completed Phases (Alpha / Beta v0.1.0)

### Phase 1 — Foundation
- Project scaffold: TypeScript/Fastify backend, Next.js frontend
- Basic chat endpoint (HTTP + SSE streaming)
- SQLite database with `node:sqlite` (WAL mode)
- Sessions and messages persistence

### Phase 2 — ReAct Agent Core
- Async-generator ReAct loop (`src/core/agent.ts`)
- Built-in tools: `plan_task`, `memory_remember`, `memory_recall`
- LLM adapter interface with OpenAI and Anthropic providers
- Streaming `ExecutionStep` objects to frontend

### Phase 3 — Skill System
- `SKILL.md` protocol: YAML frontmatter + action definitions
- Dynamic `import()` of skill `index.ts` implementations
- Three skill directories: `built-in/`, `installed/`, `local/`
- Hot-reload via `reloadSkill()`

### Phase 4 — Frontend Chat UI
- Next.js 16 App Router + React 19
- `@assistant-ui/react` custom `ChatModelAdapter`
- SSE chunk handling: `content`, `thought`, `plan`, `action`, `observation`, `answer`
- Tailwind CSS 4 + shadcn/ui component library

### Phase 5 — Stability & Context Management
- `ContextManager`: sliding window + LLM summary compression
- `SessionMemoryManager` with LRU eviction and TTL
- Tool execution timeout (60 s)
- Dependency cleanup (removed sql.js, bullmq)
- 28 new tests via Vitest

### Phase 6 — Memory & MCP Protocol
- Long-term memory: SQLite storage + cosine vector search + LIKE fallback
- Agent built-in tools: `memory_remember` / `memory_recall`
- Auto-inject top-3 relevant memories into system prompt
- `McpSkillSource`: stdio/SSE transport, exponential-backoff reconnect
- Live MCP config endpoints in gateway

### Phase 7 — Security, DAG Tasks & Auth
- Shell sandbox `CommandSandbox` (blocklist/allowlist mode)
- Auth middleware: API Key + JWT, disabled by default
- Task DAG: `tasks` table + `TaskRepository` + `DAGExecutor`
- Agent DAG tools: `dag_create_task`, `dag_get_status`, `dag_execute`
- Frontend `task_*` event handling

### Phase 8 — Advanced Frontend (assistant-ui)
- ActionBar: Copy + Reload buttons
- Syntax highlighting via `SyntaxHighlighter`
- Tool UI cards (`web/src/components/tool-ui.tsx`)
- Welcome suggestions, dynamic suggestions, feedback system
- Session list sidebar
- New endpoints: `PATCH /api/sessions/:id/title`, `POST /api/feedback`
- New DB table: `feedback`; new SSE chunks: `meta`, `suggestions`

### Phase 9 — AI/Tool/Skill Optimization
- AI CLI skills: `gemini-cli` (ask/analyze_code/search_web), `claude-code` (ask/code_review/continue_session)
- Configurable embedding model (`LLMConfig.embeddingModel`, default `text-embedding-3-small`)
- MCP Registry: browse/search/install from `registry.modelcontextprotocol.io`
- Streamable HTTP transport support
- MCP env-var passthrough to `StdioClientTransport`
- Parallel tool calls: builtins sequential, externals `Promise.allSettled`
- CJK-aware tokenizer integrated into `ContextManager`
- Frontend: Skills page with 3 tabs (Active / MCP / Registry), per-provider settings, embedding model config

**Status: Alpha / Beta v0.1.0 — 90 tests passing**

---

## Upcoming Phases

### Phase 10 — Foundation Fixes & UX Polish
*Goal: production-ready stability*

| Item | Description |
|------|-------------|
| Message count display | Show per-session message/token counts in sidebar |
| DAG visualization | Interactive task dependency graph in frontend |
| Pagination | Infinite scroll for session history and message lists |
| Error boundary | Global React error boundary + graceful degradation |
| Accessibility | ARIA labels, keyboard navigation, screen reader support |
| Mobile responsive | Sidebar collapse, touch-friendly UI |
| Config hot-reload | Reload `default.yaml` without restarting server |
| Rate limiting | Per-user and per-session request throttling |

---

### Phase 11 — Daily Work Skills
*Goal: out-of-the-box productivity for knowledge workers*

| Skill | Actions | Description |
|-------|---------|-------------|
| `notification` | send, schedule, subscribe | Push notifications via email/Slack/DingTalk/WeCom |
| `document-processor` | parse, summarize, extract, convert | PDF/Word/Excel/PowerPoint processing |
| `vision` | describe, ocr, detect_objects, compare | Image understanding via multimodal LLM |
| `web-search` | search, fetch, extract, monitor | Real-time web search + content extraction |
| `translate` | translate, detect_lang, glossary | Multi-language translation with custom glossaries |

Each skill ships as a `SKILL.md` + `index.ts` pair, installable without server restart.

---

### Phase 12 — Enterprise Framework
*Goal: enterprise-grade governance, integration, and security*

#### 12.1 Connector YAML
Declarative connector definition — connect any REST/GraphQL/SOAP system in 30 lines of YAML, auto-generated into a full skill with typed parameters and OAuth support.

```yaml
connector:
  name: sap-erp
  baseUrl: ${SAP_BASE_URL}
  auth:
    type: oauth2
    tokenUrl: ${SAP_TOKEN_URL}
  actions:
    - name: get_purchase_order
      method: GET
      path: /sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/A_PurchaseOrder('{poNumber}')
```

#### 12.2 Multi-User RBAC
- User accounts linked to sessions
- Role definitions: `admin`, `operator`, `viewer`, `guest`
- Skill-level permission gates (which roles can invoke which skills)
- Per-skill rate limits per role

#### 12.3 SSO Integration
- SAML 2.0 IdP support (Azure AD, Okta, Ping)
- OIDC provider support
- JWT claim mapping to internal roles
- Session binding to SSO identity

#### 12.4 Webhooks
- Outbound webhooks on events: `message.completed`, `task.completed`, `task.failed`, `skill.error`
- HMAC-SHA256 signature on payloads
- Retry with exponential backoff
- Webhook management UI in settings page

#### 12.5 Audit Log
- Immutable audit trail for all agent actions, tool calls, and skill invocations
- Exportable as CSV / JSON
- Retention policy configuration
- Searchable audit log UI

---

### Phase 13 — Innovation Features
*Goal: differentiated capabilities that set CMaster apart*

#### 13.1 Auto-Skill Generator
The flagship innovation. The agent generates a new, working skill from a natural language description.

**Flow:**
1. User describes the desired capability in plain language
2. Agent calls `skill_generate` builtin tool
3. LLM generates `SKILL.md` (metadata + action definitions) + `index.ts` (implementation)
4. Sandbox validates the generated code (static analysis + sandboxed dry run)
5. Skill is hot-loaded into the registry without restart
6. Agent immediately uses the new skill in the same conversation

**Target:** < 60 seconds from description to working skill.

#### 13.2 Multi-Agent Orchestration
Parallel execution across specialized sub-agents, coordinated by a supervisor agent.

- **Supervisor Agent**: decomposes task, assigns sub-tasks, aggregates results
- **Sub-Agents**: specialized roles (researcher, writer, coder, reviewer)
- Communication via shared message bus (in-process pub/sub or Redis)
- DAG-based dependency management between agent outputs
- Conflict resolution and result merging strategies

#### 13.3 Proactive AI (Scheduled Agent)
Agent runs autonomously on a schedule without user prompting.

- Cron-expression scheduling in skill definitions
- Daily standup report generation (pulls from Jira/Slack/Git)
- Anomaly detection on connected data sources
- Proactive notifications to configured channels
- User-defined trigger conditions (threshold alerts, event-based)

#### 13.4 Knowledge Graph (GraphRAG)
Structured enterprise knowledge with multi-hop reasoning.

- Entity extraction from documents, conversations, and structured data
- Relation-triple storage in SQLite (`knowledge_nodes`, `knowledge_edges` tables)
- Graph traversal for multi-hop Q&A (e.g., "Which team maintains the service that handles payments?")
- Hybrid retrieval: vector similarity + graph neighborhood expansion
- Visual knowledge graph explorer in frontend

#### 13.5 Visual Workflow Builder
No-code workflow construction via drag-and-drop canvas.

- Node types: Trigger, Agent Step, Skill Call, Condition, Loop, Merge
- Workflow serialized as JSON, executed by DAG engine
- Live execution visualization (node status, data flow)
- Export/import workflow definitions
- Pre-built workflow templates for common enterprise patterns

#### 13.6 LLM Router
Intelligent, cost-optimized model selection per request.

- Task classification: simple/complex/code/vision/multilingual
- Provider routing: GPT-4o for complex reasoning, GPT-4o-mini for simple Q&A, Claude for code review
- Cost tracking per session and per skill
- Fallback chain on provider error
- Configurable routing rules via `config/default.yaml`

---

## Version Milestones

| Version | Phases | Status |
|---------|--------|--------|
| v0.1.0 (Alpha/Beta) | 1–9 | Released |
| v0.2.0 | 10 (Foundation fixes) | Planned |
| v0.3.0 | 11 (Daily work skills) | Planned |
| v0.4.0 | 12 (Enterprise framework) | Planned |
| v1.0.0 | 13 (Innovation features) | Planned |
