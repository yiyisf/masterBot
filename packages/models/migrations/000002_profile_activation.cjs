exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE model_profiles DROP CONSTRAINT model_profiles_status_check;
    ALTER TABLE model_profiles
      ADD CONSTRAINT model_profiles_status_check CHECK (status IN ('active', 'inactive'));
    ALTER TABLE model_profiles
      DROP CONSTRAINT model_profiles_organization_id_route_role_key;
    CREATE UNIQUE INDEX model_profiles_active_route_idx
      ON model_profiles (organization_id, route_role) WHERE status = 'active';
  `);
};
