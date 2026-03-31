// src/db/migrations/015_booking_points.js
exports.up = (knex) =>
  knex.schema.table("bookings", (t) => {
    t.integer("points_earned").notNullable().defaultTo(0); // نقاط الحجوزات
    t.boolean("streak_bonus_applied").notNullable().defaultTo(false); // هل أعطيت نقاط الستريك
  });

exports.down = (knex) =>
  knex.schema.table("bookings", (t) => {
    t.dropColumn("points_earned");
    t.dropColumn("streak_bonus_applied");
  });