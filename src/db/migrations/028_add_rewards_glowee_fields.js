exports.up = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='level'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN level varchar(255) NOT NULL DEFAULT 'Bronze';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_started_at'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN cycle_started_at timestamptz NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_ends_at'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN cycle_ends_at timestamptz NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_points'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN cycle_points integer NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='keep_threshold'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN keep_threshold integer NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='next_threshold'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN next_threshold integer NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='streak_count'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN streak_count integer NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='highest_streak'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN highest_streak integer NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='last_streak_at'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN last_streak_at timestamptz NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='updated_at'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN updated_at timestamptz NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='created_at'
      ) THEN
        ALTER TABLE user_rewards ADD COLUMN created_at timestamptz NULL;
      END IF;
    END$$;
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='level'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN level;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_started_at'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN cycle_started_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_ends_at'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN cycle_ends_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='cycle_points'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN cycle_points;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='keep_threshold'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN keep_threshold;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='next_threshold'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN next_threshold;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='streak_count'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN streak_count;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='highest_streak'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN highest_streak;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='last_streak_at'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN last_streak_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='updated_at'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN updated_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='user_rewards' AND column_name='created_at'
      ) THEN
        ALTER TABLE user_rewards DROP COLUMN created_at;
      END IF;
    END$$;
  `);
};
