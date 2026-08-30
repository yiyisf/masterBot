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

    CREATE TABLE tool_calls (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      model_request_id text NOT NULL,
      capability_id text NOT NULL,
      tool_revision_id uuid NOT NULL,
      status text NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed', 'denied', 'awaiting_confirmation', 'requires_review')),
      idempotency_key uuid NOT NULL,
      effect text NOT NULL,
      recovery text NOT NULL,
      risks jsonb NOT NULL,
      request_hash char(64) NOT NULL,
      request_payload jsonb NOT NULL,
      request_summary jsonb NOT NULL,
      outcome_payload jsonb,
      outcome_summary jsonb,
      failure jsonb,
      external_operation_id text,
      approval_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, invocation_id, model_request_id),
      FOREIGN KEY (organization_id, tool_revision_id)
        REFERENCES tool_revisions(organization_id, id)
    );

    CREATE INDEX tool_calls_run_idx
      ON tool_calls (organization_id, run_id, created_at);
    CREATE INDEX tool_calls_review_idx
      ON tool_calls (organization_id, created_at) WHERE status = 'requires_review';

    CREATE TABLE tool_dispatch_attempts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      tool_call_id uuid NOT NULL,
      attempt_number integer NOT NULL CHECK (attempt_number > 0),
      status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'uncertain')),
      failure jsonb,
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      UNIQUE (organization_id, tool_call_id, attempt_number),
      FOREIGN KEY (organization_id, tool_call_id)
        REFERENCES tool_calls(organization_id, id)
    );
  `);
};
