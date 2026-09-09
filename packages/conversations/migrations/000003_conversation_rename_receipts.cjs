exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversation_rename_receipts (
      organization_id uuid NOT NULL,
      command_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
      request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (organization_id, command_id),
      FOREIGN KEY (organization_id, conversation_id)
        REFERENCES conversations(organization_id, id)
    );
  `);
};
