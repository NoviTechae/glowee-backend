// 048_create_partner_requests.js
// Partner requests from the Glowee app and the business dashboard.

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS partner_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_name text NOT NULL,
      contact_name text NOT NULL,
      phone text NOT NULL,
      email text,
      city text,
      instagram_or_website text,
      message text,
      source text NOT NULL DEFAULT 'app'
        CHECK (source IN ('app', 'dashboard')),
      status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'onboarded', 'declined')),
      admin_note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS partner_requests_status_created_idx
      ON partner_requests (status, created_at DESC);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS partner_requests;`);
};