// 051_service_areas_and_home_zones.js
//
// service_areas      Areas Glowee manages (Al Ain, Al Wagan, Al Qua'a...). For now each
//                    area is a circle on the map; `boundary` can later hold an exact shape.
// branch_home_zones  Which areas a branch covers for home service, on which days,
//                    with an optional minimum order and visit fee for that area.
//
// Branches with no zones keep using home_radius_km, so nothing breaks while
// salons move over to areas.

exports.up = async function up(knex) {
  await knex.schema.createTable("service_areas", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.string("name_en", 80).notNullable();
    t.string("name_ar", 80);
    t.string("emirate", 40).notNullable();
    t.decimal("lat", 9, 6).notNullable();
    t.decimal("lng", 9, 6).notNullable();
    t.specificType("center", "geography(Point, 4326)").notNullable();
    t.decimal("radius_km", 5, 1).notNullable();
    t.specificType("boundary", "geography(Polygon, 4326)").nullable();
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.unique(["emirate", "name_en"]);
    t.index(["center"], "service_areas_center_gix", "gist");
  });

  await knex.raw(`
    ALTER TABLE service_areas
      ADD CONSTRAINT service_areas_radius_positive CHECK (radius_km > 0 AND radius_km <= 200)
  `);

  await knex.schema.createTable("branch_home_zones", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("uuid_generate_v4()"));
    t.uuid("branch_id").notNullable().references("id").inTable("branches").onDelete("CASCADE");
    t.uuid("area_id").notNullable().references("id").inTable("service_areas").onDelete("RESTRICT");
    // 0 = Sunday ... 6 = Saturday, same as branch_hours. NULL means every day.
    t.specificType("days", "smallint[]").nullable();
    t.decimal("min_order_aed", 10, 2).nullable();
    t.decimal("visit_fee_aed", 10, 2).nullable();
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.unique(["branch_id", "area_id"]);
    t.index(["branch_id", "is_active"]);
  });

  await knex.raw(`
    ALTER TABLE branch_home_zones
      ADD CONSTRAINT branch_home_zones_days_valid
        CHECK (days IS NULL OR (cardinality(days) > 0 AND days <@ ARRAY[0,1,2,3,4,5,6]::smallint[])),
      ADD CONSTRAINT branch_home_zones_money_valid
        CHECK ((min_order_aed IS NULL OR min_order_aed >= 0) AND (visit_fee_aed IS NULL OR visit_fee_aed >= 0))
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("branch_home_zones");
  await knex.schema.dropTableIfExists("service_areas");
};