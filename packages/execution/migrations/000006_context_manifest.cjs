exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invocations
      ADD COLUMN context_manifest_id uuid;

    CREATE INDEX invocations_context_manifest_idx
      ON invocations (organization_id, context_manifest_id)
      WHERE context_manifest_id IS NOT NULL;
  `);
};
