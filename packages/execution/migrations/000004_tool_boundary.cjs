exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE runs
      ADD COLUMN tool_effect_in_flight boolean NOT NULL DEFAULT false;
  `);
};
