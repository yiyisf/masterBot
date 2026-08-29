# Run Walking Skeleton

Slice 1 connects Browser → API → PostgreSQL → Worker → SSE with a deterministic Echo Agent Engine.

## Local startup

```bash
npm install
npm run next:db:up
export DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next
npm run next:db:migrate

export NEXT_ARCHITECTURE_ENABLED=true
export CMASTER_RUNTIME_ENV=development
export CMASTER_DEVELOPMENT_IDENTITY_ENABLED=true
npm run next:server -- --role=all
# another terminal
npm run next:web
```

Open `http://localhost:3101/workspace`.

Development Identity is created by the trusted Server. The Browser never submits Organization or Principal IDs. Enabling Development Identity with `CMASTER_RUNTIME_ENV=production` fails startup.

## Command flow

```text
POST Conversation
→ POST Employee Message
→ POST Run with Message Trigger
→ Outbox Relay
→ PostgreSQL Lease
→ Echo Engine
→ output_ready
→ idempotent Assistant Message
→ succeeded
```

All mutating requests require a UUID `Idempotency-Key`. Reusing a key with a different normalized command returns Problem Details with `idempotency_conflict`.

## Cancellation

`output_ready` is the point of no return. Cancellation and output persistence lock the same Run:

- Cancellation commits first: Run becomes `cancelled`; later output is discarded and no Assistant Message is created.
- Output commits first: cancellation returns `409 run_cancellation_too_late`; the prepared output is delivered.

Slice 1 does not attempt cross-process interruption of an Engine already computing.

## Event replay

Canonical Run Events are stored by `(run_id, sequence)`. PostgreSQL `NOTIFY` carries only `runId` and `lastSequence`; API instances always read facts from `run_events`.

```text
GET /api/v1/runs/{runId}/events?afterSequence=7
Last-Event-ID: 7
```

SSE IDs are sequence numbers. Native EventSource uses `afterSequence` for the initial Snapshot cursor and `Last-Event-ID` for automatic reconnect. A two-second database read is the notification-loss fallback.

## PostgreSQL ownership

All tables use the default `public` Schema. Module ownership remains explicit:

```text
identity       organizations, principals
agents         agents, agent_revisions
conversations  conversations, messages
execution      runs, invocations, run_events, execution_outbox,
               run_dispatch, run_command_receipts
```

Migrations live under each owning Package and execute in dependency order. Repositories do not query another Module's tables; cross-Module reads use public Interfaces.

## Verification

```bash
npm run next:check
npm run next:db:migrate
npm run next:test:integration
```

Integration tests require a dedicated `DATABASE_URL` and exercise real PostgreSQL locks, transactions, leases, replay, and Organization isolation. Browser E2E is deferred until the Employee Workspace Slice.
