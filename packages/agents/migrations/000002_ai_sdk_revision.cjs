exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agent_revisions
      ADD COLUMN model_requirement jsonb;

    ALTER TABLE agent_revisions
      ADD CONSTRAINT agent_revisions_engine_kind_check
        CHECK (engine_kind IN ('echo', 'ai-sdk')),
      ADD CONSTRAINT agent_revisions_engine_version_check
        CHECK (engine_version = '1'),
      ADD CONSTRAINT agent_revisions_model_requirement_check CHECK (
        (engine_kind = 'echo' AND model_requirement IS NULL)
        OR
        (engine_kind = 'ai-sdk' AND model_requirement IS NOT NULL)
      );
  `);
};
