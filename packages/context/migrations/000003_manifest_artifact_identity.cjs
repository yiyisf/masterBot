exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE context_manifest_items
      ADD COLUMN artifact_id uuid;

    ALTER TABLE context_manifest_items
      ADD CONSTRAINT context_manifest_items_artifact_identity_check CHECK (
        (source_kind = 'artifact' AND artifact_id IS NOT NULL)
        OR (source_kind <> 'artifact' AND artifact_id IS NULL)
      );

    ALTER TABLE context_manifest_items
      DROP CONSTRAINT context_manifest_items_inclusion_mode_check,
      DROP CONSTRAINT context_manifest_items_consistency_check;
    ALTER TABLE context_manifest_items
      ADD CONSTRAINT context_manifest_items_inclusion_mode_check
        CHECK (inclusion_mode IN ('verbatim', 'summary', 'reference_only')),
      ADD CONSTRAINT context_manifest_items_consistency_check CHECK (
        (source_kind = 'message' AND source_sequence IS NOT NULL
          AND provenance IN ('employee_message', 'assistant_message')
          AND trust_class = 'conversation' AND inclusion_mode IN ('verbatim', 'summary'))
        OR (source_kind = 'artifact' AND source_sequence IS NULL
          AND provenance = 'artifact_version' AND trust_class = 'reference'
          AND inclusion_mode IN ('verbatim', 'summary', 'reference_only'))
        OR (source_kind = 'summary' AND source_sequence IS NULL
          AND provenance = 'context_summary' AND trust_class = 'reference'
          AND inclusion_mode = 'summary')
      );
  `);
};
