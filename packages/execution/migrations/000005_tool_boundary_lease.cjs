exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE runs
      ADD COLUMN tool_boundary_id uuid,
      ADD COLUMN tool_boundary_expires_at timestamptz;

    UPDATE runs
    SET tool_boundary_id = gen_random_uuid(),
        tool_boundary_expires_at = clock_timestamp()
    WHERE tool_effect_in_flight;

    ALTER TABLE runs DROP COLUMN tool_effect_in_flight;

    ALTER TABLE runs ADD CONSTRAINT runs_tool_boundary_pair_check CHECK (
      (tool_boundary_id IS NULL AND tool_boundary_expires_at IS NULL)
      OR (tool_boundary_id IS NOT NULL AND tool_boundary_expires_at IS NOT NULL)
    );
  `);
};
