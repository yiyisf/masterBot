exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE context_manifest_items
      ALTER COLUMN source_id DROP NOT NULL,
      ADD COLUMN workspace_id uuid,
      ADD COLUMN working_root_id uuid,
      ADD COLUMN workspace_revision_id uuid,
      ADD COLUMN file_path text,
      ADD COLUMN media_type text,
      ADD COLUMN size_bytes integer;

    ALTER TABLE context_manifest_items
      DROP CONSTRAINT context_manifest_items_source_kind_check,
      DROP CONSTRAINT context_manifest_items_provenance_check,
      DROP CONSTRAINT context_manifest_items_consistency_check;

    ALTER TABLE context_manifest_items
      ADD CONSTRAINT context_manifest_items_source_kind_check
        CHECK (source_kind IN ('message', 'artifact', 'summary', 'workspace_file')),
      ADD CONSTRAINT context_manifest_items_provenance_check
        CHECK (provenance IN (
          'employee_message', 'assistant_message', 'artifact_version',
          'context_summary', 'workspace_revision_file'
        )),
      ADD CONSTRAINT context_manifest_items_consistency_check CHECK (
        (source_kind = 'message' AND source_id IS NOT NULL AND source_sequence IS NOT NULL
          AND provenance IN ('employee_message', 'assistant_message')
          AND trust_class = 'conversation' AND inclusion_mode IN ('verbatim', 'summary')
          AND workspace_id IS NULL AND working_root_id IS NULL
          AND workspace_revision_id IS NULL AND file_path IS NULL
          AND media_type IS NULL AND size_bytes IS NULL)
        OR (source_kind = 'artifact' AND source_id IS NOT NULL AND source_sequence IS NULL
          AND provenance = 'artifact_version' AND trust_class = 'reference'
          AND inclusion_mode IN ('verbatim', 'summary', 'reference_only')
          AND workspace_id IS NULL AND working_root_id IS NULL
          AND workspace_revision_id IS NULL AND file_path IS NULL
          AND media_type IS NULL AND size_bytes IS NULL)
        OR (source_kind = 'summary' AND source_id IS NOT NULL AND source_sequence IS NULL
          AND provenance = 'context_summary' AND trust_class = 'reference'
          AND inclusion_mode = 'summary'
          AND workspace_id IS NULL AND working_root_id IS NULL
          AND workspace_revision_id IS NULL AND file_path IS NULL
          AND media_type IS NULL AND size_bytes IS NULL)
        OR (source_kind = 'workspace_file' AND source_id IS NULL
          AND artifact_id IS NULL AND source_sequence IS NULL
          AND provenance = 'workspace_revision_file' AND trust_class = 'reference'
          AND inclusion_mode = 'verbatim'
          AND workspace_id IS NOT NULL AND working_root_id IS NOT NULL
          AND workspace_revision_id IS NOT NULL
          AND file_path IS NOT NULL AND char_length(file_path) BETWEEN 1 AND 1024
          AND media_type IS NOT NULL AND char_length(media_type) BETWEEN 1 AND 100
          AND size_bytes BETWEEN 0 AND 1048576)
      );

    CREATE UNIQUE INDEX context_manifest_workspace_file_idx
      ON context_manifest_items (
        manifest_id, workspace_id, working_root_id, workspace_revision_id, file_path
      ) WHERE source_kind = 'workspace_file';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS context_manifest_workspace_file_idx;
    DELETE FROM context_manifest_items WHERE source_kind = 'workspace_file';
    ALTER TABLE context_manifest_items
      DROP CONSTRAINT context_manifest_items_source_kind_check,
      DROP CONSTRAINT context_manifest_items_provenance_check,
      DROP CONSTRAINT context_manifest_items_consistency_check;
    ALTER TABLE context_manifest_items
      ALTER COLUMN source_id SET NOT NULL,
      DROP COLUMN workspace_id,
      DROP COLUMN working_root_id,
      DROP COLUMN workspace_revision_id,
      DROP COLUMN file_path,
      DROP COLUMN media_type,
      DROP COLUMN size_bytes;
    ALTER TABLE context_manifest_items
      ADD CONSTRAINT context_manifest_items_source_kind_check
        CHECK (source_kind IN ('message', 'artifact', 'summary')),
      ADD CONSTRAINT context_manifest_items_provenance_check
        CHECK (provenance IN (
          'employee_message', 'assistant_message', 'artifact_version', 'context_summary'
        )),
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
