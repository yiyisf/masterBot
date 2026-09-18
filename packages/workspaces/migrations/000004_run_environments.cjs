exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE workspace_run_environments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      owner_principal_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      working_root_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('preparing', 'prepared', 'released')),
      created_at timestamptz NOT NULL,
      prepared_at timestamptz,
      released_at timestamptz,
      UNIQUE (organization_id, invocation_id),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, owner_principal_id, workspace_id)
        REFERENCES workspaces (organization_id, owner_principal_id, id),
      FOREIGN KEY (organization_id, workspace_id, working_root_id)
        REFERENCES workspace_roots (organization_id, workspace_id, id),
      FOREIGN KEY (organization_id, working_root_id, revision_id)
        REFERENCES workspace_revisions (organization_id, working_root_id, id),
      CHECK ((status = 'preparing' AND prepared_at IS NULL AND released_at IS NULL)
        OR (status = 'prepared' AND prepared_at IS NOT NULL AND released_at IS NULL)
        OR (status = 'released' AND prepared_at IS NOT NULL AND released_at IS NOT NULL))
    );

    CREATE INDEX workspace_run_environments_owner_idx
      ON workspace_run_environments (organization_id, owner_principal_id, invocation_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS workspace_run_environments;');
};
