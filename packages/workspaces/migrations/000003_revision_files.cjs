exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspace_revisions
      ADD COLUMN file_index_status text NOT NULL DEFAULT 'pending'
      CHECK (file_index_status IN ('pending', 'ready'));

    CREATE TABLE workspace_file_entries (
      organization_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      working_root_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1024),
      media_type text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 100),
      size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 1048576),
      sha256 char(64) NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (organization_id, revision_id, path),
      FOREIGN KEY (organization_id, working_root_id, revision_id)
        REFERENCES workspace_revisions(organization_id, working_root_id, id),
      FOREIGN KEY (organization_id, workspace_id, working_root_id)
        REFERENCES workspace_roots(organization_id, workspace_id, id)
    );

    CREATE INDEX workspace_file_entries_list_idx
      ON workspace_file_entries (organization_id, revision_id, path);
  `);
};
