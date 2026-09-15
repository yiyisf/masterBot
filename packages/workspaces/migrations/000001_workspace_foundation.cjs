exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE workspaces (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      owner_principal_id uuid NOT NULL,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      source_kind text NOT NULL CHECK (source_kind = 'empty'),
      operation_mode text NOT NULL CHECK (
        operation_mode IN ('observe', 'edit_with_confirmation', 'trusted_automation')
      ),
      lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('ready', 'archived')),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, owner_principal_id, id),
      FOREIGN KEY (organization_id, owner_principal_id)
        REFERENCES principals(organization_id, id)
    );

    CREATE TABLE workspace_roots (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      root_kind text NOT NULL CHECK (root_kind = 'default'),
      current_revision_id uuid,
      created_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, workspace_id, id),
      UNIQUE (workspace_id, root_kind),
      FOREIGN KEY (organization_id, workspace_id)
        REFERENCES workspaces(organization_id, id)
    );

    CREATE TABLE workspace_revisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      working_root_id uuid NOT NULL,
      parent_revision_id uuid,
      content_manifest_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, working_root_id, id),
      FOREIGN KEY (organization_id, workspace_id)
        REFERENCES workspaces(organization_id, id),
      FOREIGN KEY (organization_id, workspace_id, working_root_id)
        REFERENCES workspace_roots(organization_id, workspace_id, id),
      FOREIGN KEY (organization_id, working_root_id, parent_revision_id)
        REFERENCES workspace_revisions(organization_id, working_root_id, id)
    );

    ALTER TABLE workspace_roots
      ADD CONSTRAINT workspace_roots_current_revision_fk
      FOREIGN KEY (organization_id, id, current_revision_id)
      REFERENCES workspace_revisions(organization_id, working_root_id, id)
      DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE workspace_roots
      ALTER COLUMN current_revision_id SET NOT NULL;

    CREATE TABLE workspace_operation_receipts (
      organization_id uuid NOT NULL,
      principal_id uuid NOT NULL,
      operation_type text NOT NULL CHECK (
        operation_type IN ('provision_empty', 'transition_lifecycle')
      ),
      command_id uuid NOT NULL,
      request_hash char(64) NOT NULL,
      workspace_id uuid NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (organization_id, principal_id, operation_type, command_id),
      FOREIGN KEY (organization_id, principal_id)
        REFERENCES principals(organization_id, id),
      FOREIGN KEY (organization_id, principal_id, workspace_id)
        REFERENCES workspaces(organization_id, owner_principal_id, id)
    );

    CREATE INDEX workspaces_owner_recent_idx
      ON workspaces (organization_id, owner_principal_id, updated_at DESC, id DESC);
    CREATE INDEX workspace_roots_workspace_idx
      ON workspace_roots (organization_id, workspace_id, root_kind);
    CREATE INDEX workspace_revisions_root_created_idx
      ON workspace_revisions (organization_id, working_root_id, created_at DESC, id DESC);
  `);
};
