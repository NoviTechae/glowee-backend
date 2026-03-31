// migrations/024_add_timestamps_to_gift_themes.js
exports.up = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'gift_themes'
      ) THEN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'gift_themes' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE gift_themes
          ADD COLUMN created_at timestamptz DEFAULT now();
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'gift_themes' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE gift_themes
          ADD COLUMN updated_at timestamptz DEFAULT now();
        END IF;
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
        FROM information_schema.tables
        WHERE table_name = 'gift_themes'
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'gift_themes' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE gift_themes DROP COLUMN created_at;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'gift_themes' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE gift_themes DROP COLUMN updated_at;
        END IF;
      END IF;
    END$$;
  `);
};
