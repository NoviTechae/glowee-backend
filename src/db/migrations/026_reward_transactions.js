exports.up = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'reward_transactions'
      ) THEN
        CREATE TABLE reward_transactions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id bigint REFERENCES users(id) ON DELETE CASCADE,
          type reward_tx_type NOT NULL,
          points int NOT NULL,
          ref_id uuid,
          created_at timestamptz DEFAULT now()
        );
      END IF;
    END$$;
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DROP TABLE IF EXISTS reward_transactions;
  `);
};
