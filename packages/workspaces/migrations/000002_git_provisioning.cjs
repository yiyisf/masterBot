exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspaces DROP CONSTRAINT workspaces_source_kind_check;
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_source_kind_check CHECK (source_kind IN ('empty', 'git'));
    ALTER TABLE workspaces DROP CONSTRAINT workspaces_lifecycle_status_check;
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_lifecycle_status_check
      CHECK (lifecycle_status IN ('provisioning', 'ready', 'failed', 'archived'));

    ALTER TABLE workspace_operation_receipts
      DROP CONSTRAINT workspace_operation_receipts_operation_type_check;
    UPDATE workspace_operation_receipts
       SET operation_type = 'provision_workspace'
     WHERE operation_type = 'provision_empty';
    ALTER TABLE workspace_operation_receipts
      ADD CONSTRAINT workspace_operation_receipts_operation_type_check
      CHECK (operation_type IN (
        'provision_workspace', 'transition_lifecycle', 'create_worktree', 'archive_worktree'
      ));

    ALTER TABLE workspace_roots DROP CONSTRAINT workspace_roots_workspace_id_root_kind_key;
    ALTER TABLE workspace_roots DROP CONSTRAINT workspace_roots_root_kind_check;
    ALTER TABLE workspace_roots
      ADD CONSTRAINT workspace_roots_root_kind_check
      CHECK (root_kind IN ('default', 'git_worktree'));
    ALTER TABLE workspace_roots ADD COLUMN is_default boolean NOT NULL DEFAULT false;
    UPDATE workspace_roots SET is_default = true WHERE root_kind = 'default';
    CREATE UNIQUE INDEX workspace_roots_one_default_idx
      ON workspace_roots (organization_id, workspace_id) WHERE is_default;

    ALTER TABLE workspace_revisions ADD COLUMN git_commit_sha text;

    CREATE TABLE workspace_repository_bindings (
      organization_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      connector_id uuid NOT NULL,
      repository_id uuid NOT NULL,
      default_branch text NOT NULL CHECK (char_length(default_branch) BETWEEN 1 AND 255),
      created_at timestamptz NOT NULL,
      PRIMARY KEY (organization_id, workspace_id),
      FOREIGN KEY (organization_id, workspace_id)
        REFERENCES workspaces(organization_id, id)
    );

    CREATE TABLE workspace_git_worktrees (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      working_root_id uuid NOT NULL,
      branch_name text NOT NULL CHECK (char_length(branch_name) BETWEEN 1 AND 255),
      head_commit text NOT NULL CHECK (char_length(head_commit) BETWEEN 40 AND 64),
      lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('ready', 'archived')),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, working_root_id),
      UNIQUE (organization_id, workspace_id, branch_name),
      FOREIGN KEY (organization_id, workspace_id, working_root_id)
        REFERENCES workspace_roots(organization_id, workspace_id, id)
    );

    CREATE TABLE workspace_operations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      principal_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      operation_type text NOT NULL CHECK (operation_type IN ('provision_git', 'create_worktree')),
      branch_name text,
      result_worktree_id uuid,
      status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      failure_code text,
      failure_retryable boolean,
      lease_owner text,
      lease_expires_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, principal_id, workspace_id)
        REFERENCES workspaces(organization_id, owner_principal_id, id),
      FOREIGN KEY (organization_id, result_worktree_id)
        REFERENCES workspace_git_worktrees(organization_id, id),
      CHECK (
        (status = 'failed' AND failure_code IS NOT NULL AND failure_retryable IS NOT NULL)
        OR (status <> 'failed' AND failure_code IS NULL AND failure_retryable IS NULL)
      ),
      CHECK (
        (operation_type = 'provision_git' AND branch_name IS NULL)
        OR (operation_type = 'create_worktree' AND char_length(branch_name) BETWEEN 1 AND 255)
      )
    );

    ALTER TABLE workspace_operation_receipts ADD COLUMN operation_id uuid;
    ALTER TABLE workspace_operation_receipts ADD COLUMN worktree_id uuid;
    ALTER TABLE workspace_operation_receipts
      ADD CONSTRAINT workspace_operation_receipts_operation_fk
      FOREIGN KEY (organization_id, operation_id)
      REFERENCES workspace_operations(organization_id, id);
    ALTER TABLE workspace_operation_receipts
      ADD CONSTRAINT workspace_operation_receipts_worktree_fk
      FOREIGN KEY (organization_id, worktree_id)
      REFERENCES workspace_git_worktrees(organization_id, id);

    CREATE TABLE workspace_outbox (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      event_type text NOT NULL CHECK (
        event_type IN ('git_workspace_provision_requested', 'git_worktree_create_requested')
      ),
      available_at timestamptz NOT NULL,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL,
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, operation_id)
        REFERENCES workspace_operations(organization_id, id)
    );

    CREATE INDEX workspace_operations_pending_idx
      ON workspace_operations (operation_type, status, updated_at, id)
      WHERE status IN ('pending', 'running');
    CREATE UNIQUE INDEX workspace_operations_active_branch_idx
      ON workspace_operations (organization_id, workspace_id, branch_name)
      WHERE operation_type = 'create_worktree' AND status IN ('pending', 'running', 'succeeded');
    CREATE INDEX workspace_outbox_available_idx
      ON workspace_outbox (available_at, id)
      WHERE delivered_at IS NULL;
  `);
};
