exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE TABLE principals (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      principal_type text NOT NULL CHECK (principal_type IN ('employee', 'service')),
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id)
    );
  `);
};
