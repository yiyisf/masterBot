exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE runs
      ADD COLUMN resolved_model_profile_id uuid,
      ADD COLUMN resolved_model_display_name text,
      ADD COLUMN model_fallback_used boolean NOT NULL DEFAULT false,
      ADD COLUMN model_usage jsonb,
      ADD CONSTRAINT runs_engine_kind_check CHECK (resolved_engine_kind IN ('echo', 'ai-sdk')),
      ADD CONSTRAINT runs_engine_version_check CHECK (resolved_engine_version = '1'),
      ADD CONSTRAINT runs_model_snapshot_check CHECK (
        (resolved_model_profile_id IS NULL) = (resolved_model_display_name IS NULL)
      );

    ALTER TABLE invocations
      ADD COLUMN output_generation integer NOT NULL DEFAULT 0 CHECK (output_generation >= 0),
      ADD COLUMN has_streamed_output boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT invocations_engine_kind_check CHECK (engine_kind IN ('echo', 'ai-sdk')),
      ADD CONSTRAINT invocations_engine_version_check CHECK (engine_version = '1');
  `);
};
