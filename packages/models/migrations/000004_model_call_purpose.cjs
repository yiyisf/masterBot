exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE model_calls
      ADD COLUMN purpose text NOT NULL DEFAULT 'agent_execution'
      CHECK (purpose IN ('agent_execution', 'context_summary'));
  `);
};
