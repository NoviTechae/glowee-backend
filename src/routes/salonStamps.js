// src/routes/salonStamps.js
// The salon's loyalty card: on or off, visits to fill it, and the reward.
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");
const { HOLDING_STATUSES } = require("../services/stampService");

router.use(dashboardAuthRequired, (req, res, next) => {
  if (req.dashboard?.role !== "salon") return res.status(403).json({ error: "Salon only" });
  if (!req.dashboard.salon_id) return res.status(400).json({ error: "Salon account is not linked to a salon" });
  next();
});

const DEFAULTS = {
  stamps_required: 6,
  reward_text: null,
  stamp_images: [],
  is_active: false,
  reward_kind: null,
  reward_service_id: null,
  reward_percent: null,
  reward_valid_months: 6,
};

function shape(row) {
  return {
    stamps_required: Number(row.stamps_required),
    // The old placeholder text isn't a real reward; show it as empty.
    reward_text: row.reward_text && !/^free reward$/i.test(row.reward_text) ? row.reward_text : "",
    stamp_images: Array.isArray(row.stamp_images) ? row.stamp_images : [],
    is_active: Boolean(row.is_active),
    reward_kind: row.reward_kind || null,
    reward_service_id: row.reward_service_id || null,
    reward_percent: row.reward_percent != null ? Number(row.reward_percent) : null,
    reward_valid_months: Number(row.reward_valid_months || 6),
  };
}

// GET /dashboard/salon/stamps
router.get("/", async (req, res, next) => {
  try {
    const salonId = req.dashboard.salon_id;
    const row = await db("salon_stamp_settings").where({ salon_id: salonId }).first();

    const [collecting, waiting] = await Promise.all([
      db("user_salon_stamp_cards").where({ salon_id: salonId }).where("current_stamps", ">", 0).count("* as c").first(),
      db("user_stamp_rewards as r")
        .leftJoin("bookings as b", "b.id", "r.booking_id")
        .where("r.salon_id", salonId)
        .where("r.expires_at", ">", db.fn.now())
        .where(function () {
          this.whereNull("r.booking_id").orWhereNotIn("b.status", HOLDING_STATUSES);
        })
        .count("* as c")
        .first(),
    ]);

    res.json({
      data: row ? shape(row) : { ...DEFAULTS, reward_text: "" },
      stats: { customers_collecting: Number(collecting?.c || 0), rewards_waiting: Number(waiting?.c || 0) },
    });
  } catch (e) {
    next(e);
  }
});

const Schema = z
  .object({
    is_active: z.boolean().optional(),
    stamps_required: z.number().int().min(2).max(20).optional(),
    reward_text: z.string().trim().max(60).optional(),
    reward_kind: z.enum(["free_service", "percent_off"]).nullable().optional(),
    reward_service_id: z.string().uuid().nullable().optional(),
    reward_percent: z.number().int().min(5).max(100).nullable().optional(),
    reward_valid_months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
    stamp_images: z.array(z.string().max(500)).max(20).optional(),
  })
  .strict();

// PUT /dashboard/salon/stamps
// Fields left out keep their saved value.
router.put("/", async (req, res, next) => {
  try {
    const salonId = req.dashboard.salon_id;
    const parsed = Schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid settings" });
    const body = parsed.data;

    const current = await db("salon_stamp_settings").where({ salon_id: salonId }).first();
    const next_ = { ...DEFAULTS, ...(current ? shape(current) : {}), ...body };

    // Only keep the detail that matches the kind of reward.
    if (next_.reward_kind !== "free_service") next_.reward_service_id = null;
    if (next_.reward_kind !== "percent_off") next_.reward_percent = null;

    if (next_.is_active) {
      if (!next_.reward_text || next_.reward_text.length < 2) return res.status(400).json({ error: "Write what customers get" });
      if (!next_.reward_kind) return res.status(400).json({ error: "Choose what the reward covers" });
      if (next_.reward_kind === "free_service" && !next_.reward_service_id) return res.status(400).json({ error: "Choose the free service" });
      if (next_.reward_kind === "percent_off" && !next_.reward_percent) return res.status(400).json({ error: "Enter the discount percentage" });
    }

    if (next_.reward_service_id) {
      const svc = await db("services").where({ id: next_.reward_service_id, salon_id: salonId }).first("id", "is_active");
      if (!svc) return res.status(400).json({ error: "That service isn't one of yours" });
      if (!svc.is_active) return res.status(400).json({ error: "That service is hidden. Choose an active one." });
    }

    const row = {
      stamps_required: next_.stamps_required,
      reward_text: next_.reward_text || null,
      stamp_images: JSON.stringify(next_.stamp_images || []),
      is_active: next_.is_active,
      reward_kind: next_.reward_kind,
      reward_service_id: next_.reward_service_id,
      reward_percent: next_.reward_percent,
      reward_valid_months: next_.reward_valid_months,
      updated_at: db.fn.now(),
    };

    const [saved] = await db("salon_stamp_settings")
      .insert({ salon_id: salonId, ...row, created_at: db.fn.now() })
      .onConflict("salon_id")
      .merge(row)
      .returning("*");

    res.json({ ok: true, data: shape(saved) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;