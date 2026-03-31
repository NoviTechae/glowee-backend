// src/jobs/expireGifts.js

/**
 * Cron Job: Expire old gifts
 * 
 * Runs daily at 2 AM to mark expired gifts as 'expired'
 */

const db = require("../db/knex");

async function expireGifts() {
  try {
    console.log("🕐 [CRON] Running expire gifts job...");

    // Mark all active gifts that have passed their expiry date
    const result = await db("gifts")
      .where({ status: "active" })
      .andWhere("expires_at", "<=", db.fn.now())
      .update({
        status: "expired",
        // Note: gifts table doesn't have updated_at column
      });

    console.log(`✅ [CRON] Expired ${result} gift(s)`);

    return { ok: true, expired: result };
  } catch (error) {
    console.error("❌ [CRON] Error expiring gifts:", error);
    return { ok: false, error: error.message };
  }
}

module.exports = { expireGifts };