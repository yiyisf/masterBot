exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE model_profiles (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      display_name text NOT NULL,
      route_role text NOT NULL CHECK (route_role IN ('primary', 'fallback')),
      provider_kind text NOT NULL CHECK (provider_kind = 'openai-compatible'),
      base_url text NOT NULL,
      provider_model_id text NOT NULL,
      credential_ref text NOT NULL,
      capabilities jsonb NOT NULL,
      data_handling_tier text NOT NULL,
      cost_tier text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status = 'active'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, route_role)
    );

    CREATE TABLE model_calls (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      invocation_id uuid NOT NULL,
      model_profile_id uuid NOT NULL,
      attempt_number integer NOT NULL CHECK (attempt_number > 0),
      route_role text NOT NULL CHECK (route_role IN ('primary', 'fallback')),
      status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'discarded')),
      had_output boolean NOT NULL DEFAULT false,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      failure jsonb,
      trace_id text,
      span_id text,
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      CHECK (
        (input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL)
        OR
        (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL
          AND input_tokens >= 0 AND output_tokens >= 0 AND total_tokens >= 0)
      ),
      UNIQUE (organization_id, invocation_id, attempt_number),
      FOREIGN KEY (organization_id, model_profile_id)
        REFERENCES model_profiles(organization_id, id)
    );

    CREATE INDEX model_calls_run_idx
      ON model_calls (organization_id, run_id, started_at);
    CREATE INDEX model_calls_invocation_idx
      ON model_calls (organization_id, invocation_id, attempt_number);
  `);
};
