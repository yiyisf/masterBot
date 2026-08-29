exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      created_by_principal_id uuid NOT NULL,
      title text,
      last_message_sequence integer NOT NULL DEFAULT 0,
      idempotency_key uuid NOT NULL,
      request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, idempotency_key),
      FOREIGN KEY (organization_id, created_by_principal_id)
        REFERENCES principals(organization_id, id)
    );

    CREATE TABLE messages (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
      sequence integer NOT NULL CHECK (sequence > 0),
      author_type text NOT NULL CHECK (author_type IN ('employee', 'assistant')),
      author_principal_id uuid,
      parts jsonb NOT NULL,
      idempotency_key uuid,
      request_hash char(64),
      source_run_id uuid,
      source_invocation_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (conversation_id, sequence),
      UNIQUE (organization_id, idempotency_key),
      UNIQUE (organization_id, source_run_id),
      FOREIGN KEY (organization_id, conversation_id)
        REFERENCES conversations(organization_id, id),
      FOREIGN KEY (organization_id, author_principal_id)
        REFERENCES principals(organization_id, id),
      CHECK (
        (author_type = 'employee' AND author_principal_id IS NOT NULL AND idempotency_key IS NOT NULL AND source_run_id IS NULL)
        OR
        (author_type = 'assistant' AND author_principal_id IS NULL AND idempotency_key IS NULL AND source_run_id IS NOT NULL AND source_invocation_id IS NOT NULL)
      )
    );

    CREATE INDEX messages_conversation_sequence_idx
      ON messages (conversation_id, sequence);
  `);
};
