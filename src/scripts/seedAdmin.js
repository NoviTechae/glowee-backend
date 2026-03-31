// src/scripts/seedAdmin.js
require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("../db/knex");

async function run() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@glowee.ae").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "Glowee@2026!";

  const existing = await db("dashboard_accounts")
    .whereRaw("lower(email) = lower(?)", [email])
    .first();

  if (existing) {
    console.log("✅ Admin already exists:", existing.email);
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(password, 10);

  const [acc] = await db("dashboard_accounts")
    .insert({
      role: "admin",
      email,
      password_hash,
      salon_id: null,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(["id", "email", "role"]);

  console.log("✅ Admin created:", acc);
  console.log("🔑 Login with:", email, password);
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});