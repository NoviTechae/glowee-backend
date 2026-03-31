// src/controllers/rewardController.js
const knex = require("../db/knex");
const dayjs = require("dayjs");
const { addWalletBalance } = require("./walletController");

const LEVELS = [
  { name: "Bronze", min: 0, next: "Silver", nextMin: 1200 },
  { name: "Silver", min: 1200, next: "Gold", nextMin: 3000 },
  { name: "Gold", min: 3000, next: "Platinum", nextMin: 6000 },
  { name: "Platinum", min: 6000, next: null, nextMin: null },
];

function pickLevelByTotalEarned(total) {
  const t = Number(total || 0);
  if (t >= 6000) return "Platinum";
  if (t >= 3000) return "Gold";
  if (t >= 1200) return "Silver";
  return "Bronze";
}

function getLevelMeta(levelName) {
  const idx = LEVELS.findIndex((x) => x.name === levelName);
  const cur = LEVELS[idx >= 0 ? idx : 0];
  const prevMin = cur.min;
  const nextMin = cur.nextMin;

  return { cur, prevMin, nextMin };
}

// ✅ تأكد row موجود
async function ensureRewardRow(userId, trx = knex) {
  let row = await trx("user_rewards").where({ user_id: userId }).first();

  if (!row) {
    await trx("user_rewards").insert({
      user_id: userId,
      points_balance: 0,
      total_earned: 0,
      total_spent: 0,
      monthly_streak_count: 0,
      current_month_bookings: 0,
      last_booking_month: dayjs().format("YYYY-MM"),
      level_name: "Bronze",
      level_expires_at: null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    row = await trx("user_rewards").where({ user_id: userId }).first();
  }

  return row;
}

// ✅ ترقية Level “سنة” (إذا ارتفع total_earned)
async function maybeUpgradeLevel(userId, trx = knex) {
  const row = await ensureRewardRow(userId, trx);

  const desired = pickLevelByTotalEarned(row.total_earned);
  const current = row.level_name || "Bronze";

  // لو نفس الليفل ما نسوي شي
  if (desired === current) return row;

  // ✅ Upgrade فقط (ما ننزل هنا)
  const order = ["Bronze", "Silver", "Gold", "Platinum"];
  if (order.indexOf(desired) <= order.indexOf(current)) return row;

  const expires = dayjs().add(12, "month").toDate();

  await trx("user_rewards")
    .where({ user_id: userId })
    .update({
      level_name: desired,
      level_expires_at: expires,
      updated_at: trx.fn.now(),
    });

  return await trx("user_rewards").where({ user_id: userId }).first();
}

// ✅ لو انتهت سنة الليفل: نعيد حساب الليفل بناءً على total_earned (بدون downgrade عنيف حسب فترة — MVP)
async function ensureLevelNotExpired(userId, trx = knex) {
  const row = await ensureRewardRow(userId, trx);
  if (!row.level_expires_at) return row;

  const expired = dayjs(row.level_expires_at).isBefore(dayjs());
  if (!expired) return row;

  const recalculated = pickLevelByTotalEarned(row.total_earned);
  const expires = dayjs().add(12, "month").toDate();

  await trx("user_rewards")
    .where({ user_id: userId })
    .update({
      level_name: recalculated,
      level_expires_at: expires, // نفتح سنة جديدة من وقت التحديث
      updated_at: trx.fn.now(),
    });

  return await trx("user_rewards").where({ user_id: userId }).first();
}

// ✅ إضافة نقاط (يدعم trx)
async function addPoints(userId, points, type, refId = null, trx = knex) {
  const p = Number(points || 0);
  if (!p || p <= 0) return;

  await ensureRewardRow(userId, trx);

  await trx("reward_transactions").insert({
    user_id: userId,
    type,
    points: p,
    ref_id: refId,
    created_at: trx.fn.now(),
  });

  await trx("user_rewards")
    .where({ user_id: userId })
    .increment({
      points_balance: p,
      total_earned: p,
    })
    .update({ updated_at: trx.fn.now() });

  // ✅ بعد الإضافة شيّكي upgrade
  await maybeUpgradeLevel(userId, trx);
}

// ✅ خصم نقاط
async function deductPoints(userId, points, trx = knex) {
  const p = Number(points || 0);
  if (!p || p <= 0) return;

  const row = await ensureRewardRow(userId, trx);
  if (Number(row.points_balance) < p) throw new Error("Not enough points");

  await trx("reward_transactions").insert({
    user_id: userId,
    type: "conversion",
    points: -p,
    created_at: trx.fn.now(),
  });

  await trx("user_rewards")
    .where({ user_id: userId })
    .increment({
      points_balance: -p,
      total_spent: p,
    })
    .update({ updated_at: trx.fn.now() });
}

// =============================
// GET /rewards/summary
// =============================
async function getRewardsSummary(req, res) {
  try {
    const userId = Number(req.user.sub); // ✅ bigint
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // ✅ تأكد level expiry + ensure row
    let row = await ensureLevelNotExpired(userId);
    row = await ensureRewardRow(userId);

    const level = row.level_name || "Bronze";
    const { cur, nextMin } = getLevelMeta(level);

    // progress داخل المستوى (من min إلى nextMin)
    let progress = 1;
    if (nextMin != null) {
      const span = Math.max(1, nextMin - cur.min);
      progress = Math.min(1, (Number(row.total_earned) - cur.min) / span);
    }

    // Days left
    const days_left = row.level_expires_at
      ? Math.max(0, dayjs(row.level_expires_at).diff(dayjs(), "day"))
      : null;

    const next_level = cur.next;
    const next_level_points_left =
      nextMin == null ? 0 : Math.max(0, nextMin - Number(row.total_earned || 0));

    return res.json({
      ok: true,
      data: {
        points_balance: Number(row.points_balance || 0),
        total_earned: Number(row.total_earned || 0),
        total_spent: Number(row.total_spent || 0),

        level,
        level_expires_at: row.level_expires_at,
        days_left,

        next_level,
        next_level_points_left,
        progress,

        // monthly streak
        monthly_streak: Number(row.monthly_streak_count || 0),
        current_month_bookings: Number(row.current_month_bookings || 0),
      },
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// =============================
// POST /rewards/convert  (400 pts -> 5 AED)
// =============================
async function convertPoints(req, res) {
  const trx = await knex.transaction();
  try {
    const userId = Number(req.user.sub);
    if (!userId) {
      await trx.rollback();
      return res.status(401).json({ error: "Unauthorized" });
    }

    await ensureRewardRow(userId, trx);

    const reward = await trx("user_rewards").where({ user_id: userId }).first();
    if (Number(reward.points_balance) < 400) {
      await trx.rollback();
      return res.status(400).json({ error: "Not enough points" });
    }

    await deductPoints(userId, 400, trx);

    // ✅ wallet +5
    await addWalletBalance(userId, 5, "Convert 400 points", null, "topup", trx);

    await trx.commit();
    return res.json({ ok: true });
  } catch (err) {
    await trx.rollback();
    console.log(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function mapRewardType(type) {
  // للـ UI مثل Beanz
  switch (type) {
    case "booking_completed":
    case "booking":
      return { title: "Booking completed", kind: "base" };

    case "gift_sent":
      return { title: "Send gift", kind: "bonus" };

    case "gift_opened":
      return { title: "Gift opened", kind: "bonus" };

    case "wallet_topup":
      return { title: "Wallet topup", kind: "bonus" };

    case "streak_bonus":
      return { title: "Streak bonus", kind: "bonus" };

    case "conversion":
      return { title: "Converted points", kind: "spent" };

    default:
      return { title: type, kind: "other" };
  }
}

// ✅ GET /rewards/transactions
async function getRewardsTransactions(req, res) {
  try {
    const userId = req.user.sub;

    // تأكد صف موجود
    // (إذا عندك ensureRewardRow موجود هنا، استخدميه)
    // await ensureRewardRow(userId);

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));

    const rows = await knex("reward_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(limit)
      .select(["id", "type", "points", "ref_id", "created_at"]);

    const data = rows.map((r) => {
      const meta = mapRewardType(r.type);
      return {
        id: r.id,
        type: r.type,
        title: meta.title,
        kind: meta.kind, // base | bonus | spent | other
        points: Number(r.points || 0),
        ref_id: r.ref_id ?? null,
        created_at: r.created_at,
      };
    });

    return res.json({ ok: true, data });
  } catch (e) {
    console.log("getRewardsTransactions error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  addPoints,
  deductPoints,
  getRewardsSummary,
  convertPoints,
  getRewardsTransactions, // ✅ NEW

};