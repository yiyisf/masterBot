exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      initiating_principal_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
      trigger_type text NOT NULL CHECK (trigger_type = 'message'),
      trigger_ref uuid NOT NULL,
      agent_id uuid NOT NULL,
      agent_revision_id uuid NOT NULL,
      resolved_engine_kind text NOT NULL,
      resolved_engine_version text NOT NULL,
      root_invocation_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('accepted', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
      last_sequence integer NOT NULL DEFAULT 0,
      assistant_message_id uuid,
      failure jsonb,
      idempotency_key uuid NOT NULL,
      request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      started_at timestamptz,
      completed_at timestamptz,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, idempotency_key),
      FOREIGN KEY (organization_id, initiating_principal_id) REFERENCES principals(organization_id, id),
      FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations(organization_id, id),
      FOREIGN KEY (organization_id, agent_id) REFERENCES agents(organization_id, id),
      FOREIGN KEY (organization_id, agent_revision_id) REFERENCES agent_revisions(organization_id, id)
    );

    CREATE TABLE invocations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      parent_invocation_id uuid,
      agent_revision_id uuid NOT NULL,
      engine_kind text NOT NULL,
      engine_version text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
      prepared_output jsonb,
      output_ready_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      started_at timestamptz,
      completed_at timestamptz,
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, run_id) REFERENCES runs(organization_id, id),
      FOREIGN KEY (organization_id, parent_invocation_id) REFERENCES invocations(organization_id, id),
      FOREIGN KEY (organization_id, agent_revision_id) REFERENCES agent_revisions(organization_id, id)
    );

    ALTER TABLE runs ADD CONSTRAINT runs_root_invocation_fk
      FOREIGN KEY (organization_id, root_invocation_id)
      REFERENCES invocations(organization_id, id)
      DEFERRABLE INITIALLY DEFERRED;

    CREATE TABLE run_events (
      event_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      sequence integer NOT NULL CHECK (sequence > 0),
      schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
      event_type text NOT NULL,
      event_data jsonb NOT NULL,
      causation_id uuid,
      correlation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (run_id, sequence),
      FOREIGN KEY (organization_id, run_id) REFERENCES runs(organization_id, id)
    );

    CREATE INDEX run_events_replay_idx ON run_events (run_id, sequence);

    CREATE TABLE execution_outbox (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      aggregate_id uuid NOT NULL,
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      published_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (event_type, aggregate_id),
      FOREIGN KEY (organization_id, aggregate_id) REFERENCES runs(organization_id, id)
    );

    CREATE INDEX execution_outbox_pending_idx
      ON execution_outbox (available_at, created_at) WHERE status = 'pending';

    CREATE TABLE run_dispatch (
      run_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'failed')),
      available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      lease_owner text,
      lease_token uuid,
      lease_expires_at timestamptz,
      attempt_number integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (organization_id, run_id) REFERENCES runs(organization_id, id)
    );

    CREATE INDEX run_dispatch_ready_idx
      ON run_dispatch (available_at, lease_expires_at) WHERE status = 'pending';

    CREATE TABLE run_command_receipts (
      organization_id uuid NOT NULL,
      command_type text NOT NULL,
      idempotency_key uuid NOT NULL,
      target_run_id uuid NOT NULL,
      request_hash char(64) NOT NULL,
      response_status integer NOT NULL,
      response_body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (organization_id, command_type, idempotency_key),
      FOREIGN KEY (organization_id, target_run_id) REFERENCES runs(organization_id, id)
    );

    CREATE INDEX runs_status_created_idx ON runs (organization_id, status, created_at);
  `);
};
