// 057_wallets_unique_user.js
// One wallet per customer. Stops two wallets being created for the same person
// (two requests at the same moment), which would split their balance.

exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallets_user_id_unique'
      ) THEN
        ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_unique UNIQUE (user_id);
      END IF;
    END $$;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_user_id_unique`);
};