# Workspace Foundation Development

Slice 0 establishes an isolated, runnable foundation beside the frozen prototype.

## Layout

```text
apps/server              Fastify API/Worker composition root
apps/web                 Next.js server-runtime application
packages/kernel          Brand and Clock primitives
packages/contracts       Zod contracts, OpenAPI, generated types/client
infra/dev                PostgreSQL 17 development service
tooling                  Module-boundary checks and fixtures
```

Future Module ownership is listed in `packages/README.md`; placeholder business packages are not created.

## Start locally

```bash
npm install
npm run next:db:up
export DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next
npm run next:db:migrate
export NEXT_ARCHITECTURE_ENABLED=true
export CMASTER_DEVELOPMENT_IDENTITY_ENABLED=true
npm run next:server -- --role=all
# another terminal
npm run next:web
```

The API listens on port 3100 and Web on 3101. `CMASTER_WEB_ORIGIN` defaults to `http://localhost:3101` and constrains development CORS. Contract source uses package-private `#internal/*` imports so Turbopack development resolves explicit TypeScript sources while emitted NodeNext ESM resolves the corresponding JavaScript files.

Server roles:

```bash
npm run next:server -- --role=api
npm run next:server -- --role=worker
npm run next:server -- --role=all
```

Endpoints:

- `GET /health/live`: process liveness; does not depend on PostgreSQL.
- `GET /health/ready`: PostgreSQL-aware readiness.
- `GET /api/v1/system/status`: non-sensitive versioned status, mounted only when `NEXT_ARCHITECTURE_ENABLED=true`.

## Contracts

The source Zod schema generates both committed artifacts:

```text
packages/contracts/openapi/openapi.v1.json
packages/contracts/src/generated/openapi.d.ts
```

Regenerate with `npm run contracts:generate`. CI uses `npm run contracts:check` to reject drift. Consumers use `createContractClient` from the package root; generated-file and deep imports are prohibited.

## Verification

```bash
npm run next:check
DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next \
  npm run next:test:integration
```

`next:check` runs Contract drift, Module boundaries, ESLint, production/test TypeScript checks, production builds, and non-Docker tests. Integration tests are explicit and fail fast when `DATABASE_URL` is absent.

The legacy and Workspace CI jobs remain independent. See `docs/engineering/legacy-freeze.md` for replacement rules and status.
