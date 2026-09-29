// 049_branch_service_modes.js
// Each branch now says what it offers:
//   offers_in_salon        customers come to this address (shown in the Salon tab)
//   supports_home_services the team travels to customers (shown in the Home tab)
//   home_radius_km         how far the home service reaches from this branch
// The salon's type (in_salon / home / both) is then worked out from its branches.

exports.up = async function up(knex) {
  await knex.schema.alterTable("branches", (t) => {
    t.boolean("offers_in_salon").notNullable().defaultTo(true);
    t.decimal("home_radius_km", 5, 1).nullable();
  });

  // Home-only businesses: their branch is a starting point, not a place to visit.
  await knex.raw(`
    UPDATE branches b
    SET offers_in_salon = false,
        supports_home_services = true,
        home_radius_km = COALESCE(b.home_radius_km, 25)
    FROM salons s
    WHERE s.id = b.salon_id AND s.salon_type = 'home'
  `);

  // Any other branch that already offers home service gets a starting radius
  // the salon can change later.
  await knex.raw(`
    UPDATE branches
    SET home_radius_km = COALESCE(home_radius_km, 15)
    WHERE supports_home_services = true
  `);

  // A branch must offer at least one thing, and home service needs a radius.
  await knex.raw(`
    ALTER TABLE branches
      ADD CONSTRAINT branches_offers_something
        CHECK (offers_in_salon OR supports_home_services),
      ADD CONSTRAINT branches_home_needs_radius
        CHECK (NOT supports_home_services OR (home_radius_km IS NOT NULL AND home_radius_km > 0))
  `);

  // Bring every salon's type in line with its branches.
  await knex.raw(`
    UPDATE salons s
    SET salon_type = CASE
        WHEN x.has_in AND x.has_home THEN 'both'
        WHEN x.has_home THEN 'home'
        ELSE 'in_salon'
      END
    FROM (
      SELECT salon_id,
             bool_or(offers_in_salon) AS has_in,
             bool_or(supports_home_services) AS has_home
      FROM branches
      GROUP BY salon_id
    ) x
    WHERE x.salon_id = s.id
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE branches
      DROP CONSTRAINT IF EXISTS branches_offers_something,
      DROP CONSTRAINT IF EXISTS branches_home_needs_radius
  `);
  await knex.schema.alterTable("branches", (t) => {
    t.dropColumn("offers_in_salon");
    t.dropColumn("home_radius_km");
  });
};