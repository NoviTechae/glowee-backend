exports.up = async (knex) => {
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_unique_split_wallet_booking
    ON payment_transactions (user_id, booking_id)
    WHERE provider = 'wallet'
      AND type = 'booking_payment'
      AND status = 'succeeded'
      AND COALESCE((metadata->>'wallet_portion')::boolean, false) = true
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DROP INDEX IF EXISTS payment_transactions_unique_split_wallet_booking
  `);
};
