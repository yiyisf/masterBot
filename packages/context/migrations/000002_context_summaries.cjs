exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE context_manifests
      DROP CONSTRAINT context_manifests_summarized_check;

    CREATE TABLE context_summaries (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      invocation_id uuid NOT NULL,
      source_start_sequence integer NOT NULL CHECK (source_start_sequence > 0),
      source_end_sequence integer NOT NULL CHECK (source_end_sequence >= source_start_sequence),
      source_hash char(64) NOT NULL,
      content text NOT NULL,
      content_hash char(64) NOT NULL,
      model_call_id uuid NOT NULL,
      model_profile_id uuid NOT NULL,
      model_usage jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, invocation_id),
      UNIQUE (organization_id, id)
    );

    ALTER TABLE context_manifest_items
      DROP CONSTRAINT context_manifest_items_check;
    ALTER TABLE context_manifest_items
      ADD CONSTRAINT context_manifest_items_consistency_check CHECK (
        (source_kind = 'message' AND source_sequence IS NOT NULL
          AND provenance IN ('employee_message', 'assistant_message')
          AND trust_class = 'conversation' AND inclusion_mode IN ('verbatim', 'summary'))
        OR (source_kind = 'artifact' AND source_sequence IS NULL
          AND provenance = 'artifact_version'
          AND trust_class = 'reference' AND inclusion_mode = 'verbatim')
        OR (source_kind = 'summary' AND source_sequence IS NULL
          AND provenance = 'context_summary'
          AND trust_class = 'reference' AND inclusion_mode = 'summary')
      );
  `);
};
