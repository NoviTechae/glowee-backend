// src/db/migrations/039_fix_user_addresses.js
exports.up = async (knex) => {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "postgis";`);

  const hasTable = await knex.schema.hasTable("user_addresses");
  if (!hasTable) return;

  const hasGeo = await knex.schema.hasColumn("user_addresses", "geo");
  if (!hasGeo) {
    await knex.schema.alterTable("user_addresses", (t) => {
      t.specificType("geo", "geography(Point, 4326)");
    });
  }

  await knex.raw(`
    UPDATE user_addresses
    SET geo = ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
    WHERE geo IS NULL
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS user_addresses_geo_gix
    ON user_addresses
    USING GIST (geo)
  `);
};

exports.down = async (knex) => {
  const hasTable = await knex.schema.hasTable("user_addresses");
  if (!hasTable) return;

  const hasGeo = await knex.schema.hasColumn("user_addresses", "geo");
  if (hasGeo) {
    await knex.schema.alterTable("user_addresses", (t) => {
      t.dropColumn("geo");
    });
  }

  await knex.raw(`DROP INDEX IF EXISTS user_addresses_geo_gix`);
};