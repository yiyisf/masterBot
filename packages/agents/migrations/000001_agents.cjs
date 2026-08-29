exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agents (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      name text NOT NULL,
      active_revision_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, name)
    );

    CREATE TABLE agent_revisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      revision_number integer NOT NULL CHECK (revision_number > 0),
      engine_kind text NOT NULL,
      engine_version text NOT NULL,
      status text NOT NULL CHECK (status = 'published'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (agent_id, revision_number),
      FOREIGN KEY (organization_id, agent_id) REFERENCES agents(organization_id, id)
    );

    ALTER TABLE agents ADD CONSTRAINT agents_active_revision_fk
      FOREIGN KEY (organization_id, active_revision_id)
      REFERENCES agent_revisions(organization_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  `);
};
