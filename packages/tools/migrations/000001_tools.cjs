exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE tool_capabilities (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (organization_id, id)
    );

    CREATE TABLE tool_revisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      capability_id text NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      input_schema jsonb NOT NULL,
      effect text NOT NULL
        CHECK (effect IN ('read_only', 'idempotent_write', 'non_idempotent_write')),
      recovery text NOT NULL
        CHECK (recovery IN ('retry_same_call', 'idempotency_key', 'reconcile', 'manual_review')),
      risks jsonb NOT NULL,
      provider_key text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status = 'active'),
      config_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, capability_id)
        REFERENCES tool_capabilities(organization_id, id)
    );

    CREATE UNIQUE INDEX tool_revisions_active_capability_idx
      ON tool_revisions (organization_id, capability_id) WHERE status = 'active';

    CREATE TABLE tool_grants (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      capability_ids jsonb NOT NULL,
      config_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      CHECK (jsonb_typeof(capability_ids) = 'array')
    );
  `);
};
