exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspace_run_environments ADD COLUMN maximum_operation_mode text;
    UPDATE workspace_run_environments env
      SET maximum_operation_mode = w.operation_mode
      FROM workspaces w
      WHERE w.organization_id = env.organization_id AND w.id = env.workspace_id;
    ALTER TABLE workspace_run_environments ALTER COLUMN maximum_operation_mode SET NOT NULL;
    ALTER TABLE workspace_run_environments ADD CONSTRAINT workspace_run_environments_max_mode_check
      CHECK (maximum_operation_mode IN ('observe', 'edit_with_confirmation', 'trusted_automation'));

    ALTER TABLE workspace_revisions ADD COLUMN content_kind text;
    UPDATE workspace_revisions
      SET content_kind = CASE WHEN git_commit_sha IS NULL THEN 'empty' ELSE 'git_commit' END;
    ALTER TABLE workspace_revisions ALTER COLUMN content_kind SET NOT NULL;
    ALTER TABLE workspace_revisions ADD CONSTRAINT workspace_revisions_content_kind_check
      CHECK ((content_kind = 'empty' AND git_commit_sha IS NULL)
        OR (content_kind IN ('git_commit', 'git_snapshot') AND git_commit_sha IS NOT NULL)
        OR (content_kind = 'snapshot' AND git_commit_sha IS NULL));

    CREATE TABLE workspace_change_sets (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      owner_principal_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      working_root_id uuid NOT NULL,
      base_revision_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('preparing', 'proposed', 'applying', 'applied', 'conflicted')),
      resulting_revision_id uuid,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, owner_principal_id, id),
      FOREIGN KEY (organization_id, owner_principal_id, workspace_id)
        REFERENCES workspaces (organization_id, owner_principal_id, id),
      FOREIGN KEY (organization_id, workspace_id, working_root_id)
        REFERENCES workspace_roots (organization_id, workspace_id, id),
      FOREIGN KEY (organization_id, working_root_id, base_revision_id)
        REFERENCES workspace_revisions (organization_id, working_root_id, id),
      CHECK ((status IN ('applying', 'applied') AND resulting_revision_id IS NOT NULL)
        OR (status NOT IN ('applying', 'applied') AND resulting_revision_id IS NULL))
    );

    CREATE TABLE workspace_change_entries (
      change_set_id uuid NOT NULL REFERENCES workspace_change_sets(id),
      organization_id uuid NOT NULL,
      path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1024),
      change_kind text NOT NULL CHECK (change_kind IN ('add', 'modify', 'delete')),
      media_type text,
      size_bytes integer,
      sha256 char(64),
      PRIMARY KEY (change_set_id, path),
      FOREIGN KEY (organization_id, change_set_id)
        REFERENCES workspace_change_sets (organization_id, id),
      CHECK ((change_kind = 'delete' AND media_type IS NULL AND size_bytes IS NULL AND sha256 IS NULL)
        OR (change_kind IN ('add', 'modify')
          AND media_type IS NOT NULL AND char_length(media_type) BETWEEN 1 AND 100
          AND size_bytes BETWEEN 0 AND 1048576 AND sha256 IS NOT NULL))
    );

    CREATE TABLE workspace_change_receipts (
      organization_id uuid NOT NULL,
      principal_id uuid NOT NULL,
      operation_type text NOT NULL CHECK (operation_type IN ('propose_change_set', 'apply_change_set')),
      command_id uuid NOT NULL,
      request_hash char(64) NOT NULL,
      change_set_id uuid NOT NULL,
      resulting_revision_id uuid,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (organization_id, principal_id, operation_type, command_id),
      FOREIGN KEY (organization_id, principal_id)
        REFERENCES principals (organization_id, id),
      FOREIGN KEY (organization_id, principal_id, change_set_id)
        REFERENCES workspace_change_sets (organization_id, owner_principal_id, id),
      CHECK ((operation_type = 'propose_change_set' AND resulting_revision_id IS NULL)
        OR (operation_type = 'apply_change_set' AND resulting_revision_id IS NOT NULL))
    );

    CREATE INDEX workspace_change_sets_root_recent_idx
      ON workspace_change_sets (organization_id, workspace_id, working_root_id, created_at DESC, id DESC);
    CREATE INDEX workspace_change_sets_invocation_idx
      ON workspace_change_sets (organization_id, invocation_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS workspace_change_receipts;
    DROP TABLE IF EXISTS workspace_change_entries;
    DROP TABLE IF EXISTS workspace_change_sets;
    ALTER TABLE workspace_revisions DROP CONSTRAINT workspace_revisions_content_kind_check;
    ALTER TABLE workspace_revisions DROP COLUMN content_kind;
    ALTER TABLE workspace_run_environments
      DROP CONSTRAINT workspace_run_environments_max_mode_check;
    ALTER TABLE workspace_run_environments DROP COLUMN maximum_operation_mode;
  `);
};
