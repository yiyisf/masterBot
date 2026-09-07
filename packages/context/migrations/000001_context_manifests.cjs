exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE context_manifests (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      invocation_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
      trigger_message_id uuid NOT NULL,
      trigger_sequence integer NOT NULL CHECK (trigger_sequence > 0),
      context_policy_revision text NOT NULL,
      effective_input_tokens integer NOT NULL CHECK (effective_input_tokens > 0),
      estimated_input_tokens integer NOT NULL CHECK (estimated_input_tokens >= 0),
      fixed_overhead_tokens integer NOT NULL CHECK (fixed_overhead_tokens >= 0),
      item_count integer NOT NULL CHECK (item_count >= 0),
      summarized boolean NOT NULL DEFAULT false CHECK (summarized = false),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, invocation_id),
      UNIQUE (organization_id, id)
    );

    CREATE TABLE context_manifest_items (
      manifest_id uuid NOT NULL REFERENCES context_manifests(id),
      organization_id uuid NOT NULL,
      position integer NOT NULL CHECK (position >= 0),
      source_kind text NOT NULL CHECK (source_kind IN ('message', 'artifact', 'summary')),
      source_id uuid NOT NULL,
      source_sequence integer,
      source_hash char(64) NOT NULL,
      provenance text NOT NULL CHECK (
        provenance IN ('employee_message', 'assistant_message', 'artifact_version', 'context_summary')
      ),
      trust_class text NOT NULL CHECK (trust_class IN ('conversation', 'reference')),
      inclusion_mode text NOT NULL CHECK (inclusion_mode IN ('verbatim', 'summary')),
      CHECK (
        (source_kind = 'message' AND source_sequence IS NOT NULL
          AND provenance IN ('employee_message', 'assistant_message')
          AND trust_class = 'conversation' AND inclusion_mode = 'verbatim')
        OR (source_kind = 'artifact' AND source_sequence IS NULL
          AND provenance = 'artifact_version'
          AND trust_class = 'reference' AND inclusion_mode = 'verbatim')
        OR (source_kind = 'summary' AND source_sequence IS NULL
          AND provenance = 'context_summary'
          AND trust_class = 'reference' AND inclusion_mode = 'summary')
      ),
      PRIMARY KEY (manifest_id, position),
      FOREIGN KEY (organization_id, manifest_id)
        REFERENCES context_manifests(organization_id, id)
    );

    CREATE INDEX context_manifest_invocation_idx
      ON context_manifests (organization_id, invocation_id);
  `);
};
