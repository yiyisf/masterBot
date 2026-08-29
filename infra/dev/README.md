# Next Architecture Development Infrastructure

Start PostgreSQL 17:

```bash
npm run next:db:up
```

Use:

```text
DATABASE_URL=postgresql://cmaster:cmaster_dev@localhost:5432/cmaster_next
```

Apply the Module-owned migrations explicitly:

```bash
npm run next:db:migrate
```

Reset all local next-architecture database state:

```bash
npm run next:db:reset
```

The existing root `docker-compose.yml` belongs to the frozen legacy prototype and is intentionally unchanged.
