exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE model_profiles
      ADD COLUMN context_window_tokens integer,
      ADD COLUMN max_output_tokens integer,
      ADD CONSTRAINT model_profiles_context_limits_check CHECK (
        (context_window_tokens IS NULL AND max_output_tokens IS NULL)
        OR
        (context_window_tokens IS NOT NULL AND max_output_tokens IS NOT NULL
          AND context_window_tokens > 0
          AND max_output_tokens > 0
          AND context_window_tokens > max_output_tokens)
      );
  `);
};
