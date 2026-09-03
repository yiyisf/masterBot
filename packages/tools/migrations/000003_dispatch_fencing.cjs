exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tool_dispatch_attempts
      ADD COLUMN lease_expires_at timestamptz;

    UPDATE tool_dispatch_attempts
    SET lease_expires_at = COALESCE(completed_at, started_at)
    WHERE lease_expires_at IS NULL;

    ALTER TABLE tool_dispatch_attempts
      ALTER COLUMN lease_expires_at SET NOT NULL;

    CREATE INDEX tool_dispatch_attempts_recovery_idx
      ON tool_dispatch_attempts (organization_id, tool_call_id, attempt_number DESC);
  `);
};
