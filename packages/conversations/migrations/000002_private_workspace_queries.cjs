exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX conversations_creator_recent_idx
      ON conversations (organization_id, created_by_principal_id, updated_at DESC, id DESC);
  `);
};
