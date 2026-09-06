exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE artifact_contents (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      storage_adapter text NOT NULL,
      storage_ref text NOT NULL,
      content_hash char(64) NOT NULL,
      media_type text NOT NULL CHECK (media_type IN (
        'text/plain; charset=utf-8', 'text/markdown; charset=utf-8'
      )),
      size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 49152),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, content_hash, media_type)
    );

    CREATE TABLE artifacts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      kind text NOT NULL CHECK (kind = 'text'),
      created_for_principal_id uuid NOT NULL,
      current_version_number integer NOT NULL CHECK (current_version_number > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, created_for_principal_id)
        REFERENCES principals(organization_id, id)
    );

    CREATE TABLE artifact_versions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      artifact_id uuid NOT NULL,
      version_number integer NOT NULL CHECK (version_number > 0),
      content_id uuid NOT NULL,
      created_by_invocation_id uuid NOT NULL,
      source_tool_call_id uuid NOT NULL,
      source_request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, artifact_id, version_number),
      UNIQUE (organization_id, source_tool_call_id),
      FOREIGN KEY (organization_id, artifact_id)
        REFERENCES artifacts(organization_id, id),
      FOREIGN KEY (organization_id, content_id)
        REFERENCES artifact_contents(organization_id, id)
    );

    CREATE INDEX artifacts_owner_created_idx
      ON artifacts (organization_id, created_for_principal_id, created_at DESC);
  `);
};
