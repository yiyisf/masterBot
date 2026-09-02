exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE runs DROP CONSTRAINT runs_status_check;
    ALTER TABLE runs ADD CONSTRAINT runs_status_check
      CHECK (status IN ('accepted', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'));

    ALTER TABLE invocations DROP CONSTRAINT invocations_status_check;
    ALTER TABLE invocations ADD CONSTRAINT invocations_status_check
      CHECK (status IN ('pending', 'running', 'interrupted', 'succeeded', 'failed', 'cancelled'));

    ALTER TABLE run_dispatch DROP CONSTRAINT run_dispatch_status_check;
    ALTER TABLE run_dispatch ADD CONSTRAINT run_dispatch_status_check
      CHECK (status IN ('pending', 'waiting', 'completed', 'cancelled', 'failed'));

    CREATE TABLE execution_checkpoints (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      schema_version integer NOT NULL CHECK (schema_version = 1),
      checkpoint_data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      consumed_at timestamptz,
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, run_id) REFERENCES runs(organization_id, id),
      FOREIGN KEY (organization_id, invocation_id) REFERENCES invocations(organization_id, id)
    );

    CREATE TABLE execution_interrupts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      checkpoint_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('tool_confirmation', 'tool_outcome_review')),
      subject_ref text NOT NULL,
      safe_subject_summary jsonb NOT NULL,
      allowed_responses jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'cancelled')),
      resolution text,
      resolution_command_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      resolved_at timestamptz,
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, run_id) REFERENCES runs(organization_id, id),
      FOREIGN KEY (organization_id, invocation_id) REFERENCES invocations(organization_id, id),
      FOREIGN KEY (organization_id, checkpoint_id) REFERENCES execution_checkpoints(organization_id, id)
    );

    CREATE UNIQUE INDEX execution_interrupts_active_run_idx
      ON execution_interrupts (organization_id, run_id) WHERE status = 'pending';
  `);
};
