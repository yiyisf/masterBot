# CMaster Bot — Product Roadmap

## Overview

CMaster Bot is an enterprise-grade, self-evolving AI agent platform built on a ReAct pattern architecture. This roadmap documents all completed phases through Phase 18.

---

## ✅ Completed Phases

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

### Phase 8 — Advanced Frontend
- ActionBar: Copy + Reload buttons; syntax highlighting
- Tool UI cards, welcome/dynamic suggestions, feedback system
- Session list sidebar with pin/rename/delete
- New endpoints: session title PATCH, feedback POST
- New DB table: `feedback`; new SSE chunks: `meta`, `suggestions`

### Phase 9 — AI/Tool/Skill Optimization
- AI CLI skills: `gemini-cli`, `claude-code`
- Configurable embedding model (`LLMConfig.embeddingModel`)
- MCP Registry: browse/search/install from `registry.modelcontextprotocol.io`
- Streamable HTTP transport support; parallel tool calls (Promise.allSettled)
- CJK-aware tokenizer in `ContextManager`
- Frontend: Skills page with 3 tabs (Active / MCP / Registry)

### Phase 10 — Foundation Fixes & UX Polish
- Message count / token stats per session in sidebar
- DAG task visualization on frontend
- Session history pagination (infinite scroll)
- Sidebar real navigation links; session pin/rename/delete
- `hello-world` example skill

### Phase 11 — Built-in Skills Expansion
- `notification` skill: DingTalk / Feishu / Email push
- `document-processor` skill: PDF, Word, Excel read + Markdown convert
- `vision` skill: image analysis / OCR / diagram description

### Phase 12 — Enterprise Connector Framework
- `ConnectorSkillSource`: load YAML/JSON connector configs as live skills
- CRUD API: `GET/POST/DELETE /api/connectors`
- Frontend: Connectors management page

### Phase 13 — Innovation Features
- **Auto-Skill Generator**: NL description → AI generates `SKILL.md` + `index.ts` → hot-load (< 60 s)
- **Multi-Agent Orchestration**: `MultiAgentOrchestrator` + `delegate_to_agent` built-in tool
- **Proactive AI (Scheduler)**: `SchedulerService` pure-JS Cron, `scheduled_tasks` table, `/scheduled` UI
- **Knowledge Graph (GraphRAG)**: SQLite `knowledge_nodes/edges`, BFS traversal, `knowledge_search` tool, `/knowledge` UI
- **Visual Workflow Builder**: 4-node drag-and-drop editor, workflow CRUD, `/workflow` page

---

### Phase 14 — Cross-Platform Infrastructure & Webhook Inbound ✅
*Goal: Windows compatibility + inbound event trigger foundation*

| Item | Details |
|------|---------|
| Cross-platform Shell | `platform()` detection → PowerShell (win32) / bash (others); `resolvePath()` for `~` and path separators |
| Webhook Repository | SQLite-backed CRUD + trigger history (`webhook-repository.ts`) |
| DB: `webhooks` table | id, name, secret, enabled, trigger_count, last_triggered_at |
| Webhook trigger API | `POST /api/webhooks/:id/trigger` with HMAC-SHA256 verification + rate limiting |
| Webhooks UI | Create/delete webhooks, copy endpoint URL and secret, HMAC usage example |

---

### Phase 15 — NL2Insight (Natural Language Data Analysis) ✅
*Goal: NL → SQL → ECharts visualization against internal data warehouses*

| Item | Details |
|------|---------|
| `database-connector` skill | `list_tables`, `get_schema`, `execute_query` — read-only sandbox (SELECT only, max 10k rows, PII masking) |
| `nl2sql.ts` | Schema-aware NL2SQL + ECharts config generation |
| `chart-renderer.tsx` | Dynamic ECharts rendering for `` ```echarts ``` `` blocks and `chart:` prefix |
| Connector example | `connectors/data-warehouse.example.yaml` (ClickHouse/MySQL/PostgreSQL) |

---

### Phase 16 — Living Knowledge Fabric ✅
*Goal: Auto-incremental sync from any internal knowledge system*

| Item | Details |
|------|---------|
| `knowledge-graph.ts` extensions | `incrementalIngest()` — delta upsert; `findExperts(topic)` — BFS-based expert discovery; `detectConflicts()` — LLM contradiction detection |
| `knowledge-base` adapter | `list_updated_pages`, `get_page_content`, `write_page` — pluggable Wiki HTTP client |
| `knowledge-sync.ts` | `KnowledgeSyncService`: Cron + Webhook dual-trigger incremental sync |

---

### Phase 17 — AIOps Intelligent Operations Hub ✅
*Goal: Alert auto-triage, YAML Runbook declarative execution, 24×7 unattended ops*

| Item | Details |
|------|---------|
| `runbook-engine.ts` | YAML Runbook parser + DAG executor; `{{variable}}` interpolation; `condition` / `onError: continue` support |
| `log-analyzer` skill | `fetch_logs`, `cluster_anomalies`, `analyze_root_cause` — LLM-powered anomaly clustering |
| `notification-hub` adapter | `send`, `create_group`, `broadcast` — pluggable internal IM/notification system |
| Runbook examples | `runbooks/service-oom.yaml`, `runbooks/disk-full-warning.yaml` |
| Runbook API | `GET/POST /api/runbooks`, `POST /api/runbooks/:id/execute` |
| Runbooks UI | Upload, list, manual trigger with JSON variables, step-by-step result viewer |

---

### Phase 18 — Legacy System AI-RPA ✅
*Goal: Vision + Browser Automation for internal Web systems without APIs*

| Item | Details |
|------|---------|
| `browser-automation` skill | Playwright: `screenshot`, `navigate`, `click`, `type`, `upload_file`, `extract_table`, `close_browser` |
| Cross-platform browser | `platform() === 'win32'` → Edge; otherwise → Chrome |
| RPA API | `POST /api/rpa/execute`, `POST /api/rpa/prompt` |
| RPA UI | URL navigation, AI natural language instructions, live screenshot preview, execution log |

---

### Settings Page — Runtime Config Management ✅

| Item | Details |
|------|---------|
| `POST /api/config/models/test` | Real LLM connectivity test with minimal chat call |
| `GET/PATCH /api/config/security` | Sandbox (enabled/mode) + auth (enabled/mode/apiKeys/jwtSecret) |
| `GET/PATCH /api/config/agent` | `maxIterations` + `maxContextTokens` hot-update |
| Settings UI rewrite | 4 cards: AI models (test + show/hide key), Agent params, Security switches, System info summary |
| Toast notifications | All `alert()` replaced with sonner `toast.success` / `toast.error` |

---

## Version Milestones

| Version | Phases | Status |
|---------|--------|--------|
| v0.1.0 (Alpha) | 1–9 | ✅ Released |
| v0.2.0 | 10–13 (Enterprise foundation + Innovation) | ✅ Released |
| v0.3.0 | 14–18 (AIOps + RPA + NL2Insight + Cross-platform) | ✅ Released |
| v1.0.0 | Production hardening, multi-tenant RBAC, SSO | 🔜 Planned |

---

## Upcoming (v1.0.0)

### Multi-tenant RBAC
- User accounts with role definitions: `admin`, `operator`, `viewer`
- Skill-level permission gates; per-role rate limiting
- SSO: SAML 2.0 / OIDC integration (Azure AD, Okta)
- Session binding to SSO identity; memory isolation per user

### Production Hardening
- Audit log: immutable trail for all agent/tool actions, exportable CSV/JSON
- Rate limiting per user/session; request queue with backpressure
- Health dashboard: latency percentiles, error rates, LLM cost tracking
- Docker Compose / Kubernetes deployment manifests

### LLM Router
- Task classification → cost-optimized model selection
- Fallback chain on provider error
- Per-session cost tracking and reporting
