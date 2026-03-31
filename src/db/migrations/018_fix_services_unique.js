exports.up = async (knex) => {
  // drop old global unique if it exists
  await knex.raw(`
    ALTER TABLE services
    DROP CONSTRAINT IF EXISTS services_name_unique
  `);

  // add composite unique only if it doesn't already exist
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'services_salon_id_name_unique'
      ) THEN
        ALTER TABLE services
        ADD CONSTRAINT services_salon_id_name_unique
        UNIQUE (salon_id, name);
      END IF;
    END$$;
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'services_salon_id_name_unique'
      ) THEN
        ALTER TABLE services
        DROP CONSTRAINT services_salon_id_name_unique;
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'services_name_unique'
      ) THEN
        ALTER TABLE services
        ADD CONSTRAINT services_name_unique UNIQUE (name);
      END IF;
    END$$;
  `);
};
