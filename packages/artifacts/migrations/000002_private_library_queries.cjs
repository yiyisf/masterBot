exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX artifacts_owner_created_idx;
    CREATE INDEX artifacts_owner_created_id_idx
      ON artifacts (organization_id, created_for_principal_id, created_at DESC, id DESC);
  `);
};
