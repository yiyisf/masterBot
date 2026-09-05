exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agent_revisions
      ADD COLUMN context_policy_revision text,
      ADD CONSTRAINT agent_revisions_context_policy_revision_check CHECK (
        context_policy_revision IS NULL OR length(context_policy_revision) > 0
      );
  `);
};
