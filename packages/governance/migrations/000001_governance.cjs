exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE approvals (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      initiating_principal_id uuid NOT NULL,
      subject_kind text NOT NULL CHECK (subject_kind = 'tool_call'),
      subject_ref uuid NOT NULL,
      tool_revision_ref uuid NOT NULL,
      subject_request_hash char(64) NOT NULL,
      safe_subject_summary jsonb NOT NULL,
      policy_version text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected')),
      request_command_id uuid NOT NULL,
      request_command_hash char(64) NOT NULL,
      resolution_command_id uuid,
      resolution_command_hash char(64),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      resolved_at timestamptz,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, request_command_id),
      FOREIGN KEY (organization_id, initiating_principal_id)
        REFERENCES principals(organization_id, id),
      CHECK (
        (status = 'pending' AND resolution_command_id IS NULL
          AND resolution_command_hash IS NULL AND resolved_at IS NULL)
        OR
        (status IN ('confirmed', 'rejected') AND resolution_command_id IS NOT NULL
          AND resolution_command_hash IS NOT NULL AND resolved_at IS NOT NULL)
      )
    );

    CREATE INDEX approvals_subject_idx
      ON approvals (organization_id, subject_kind, subject_ref);
    CREATE INDEX approvals_pending_idx
      ON approvals (organization_id, created_at) WHERE status = 'pending';
  `);
};
