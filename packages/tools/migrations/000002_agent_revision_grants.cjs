exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agent_tool_grants (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      agent_revision_id uuid NOT NULL,
      grant_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (organization_id, agent_revision_id),
      FOREIGN KEY (organization_id, grant_id)
        REFERENCES tool_grants(organization_id, id)
    );
  `);
};
