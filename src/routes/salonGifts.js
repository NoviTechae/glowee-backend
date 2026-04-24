// src/routes/salonGifts.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") {
    return res.status(403).json({ error: "Salon only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireSalon);

function getSalonId(req) {
  return req.dashboard?.salon_id || req.dashboard?.salonId;
}

// GET /dashboard/salon/gifts/stats
router.get("/stats", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);

    if (!salonId) {
      return res.status(400).json({ error: "Salon account is not linked to a salon" });
    }

    const base = db("gifts").where("salon_id", salonId);

    const [{ total_gifts }] = await base.clone().count("* as total_gifts");
    const [{ active_gifts }] = await base.clone().where("status", "active").count("* as active_gifts");
    const [{ redeemed_gifts }] = await base.clone().where("status", "redeemed").count("* as redeemed_gifts");
    const [{ expired_gifts }] = await base.clone().where("status", "expired").count("* as expired_gifts");
    const [{ cancelled_gifts }] = await base.clone().where("status", "cancelled").count("* as cancelled_gifts");
    const [{ total_amount }] = await base.clone().sum("total_aed as total_amount");
    const [{ total_fees }] = await base.clone().sum("gift_fee_aed as total_fees");

    res.json({
      total_gifts: Number(total_gifts || 0),
      active_gifts: Number(active_gifts || 0),
      redeemed_gifts: Number(redeemed_gifts || 0),
      expired_gifts: Number(expired_gifts || 0),
      cancelled_gifts: Number(cancelled_gifts || 0),
      total_amount: Number(total_amount || 0),
      total_fees: Number(total_fees || 0),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/gifts
router.get("/", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { search, status, limit = 100 } = req.query;

    if (!salonId) {
      return res.status(400).json({ error: "Salon account is not linked to a salon" });
    }

    let query = db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .where("g.salon_id", salonId)
      .select([
        "g.id",
        "g.code",
        "g.amount_aed",
        "g.subtotal_aed",
        "g.gift_fee_aed",
        "g.total_aed",
        "g.currency",
        "g.status",
        "g.sender_name",
        "g.message",
        "g.theme_id",
        "g.recipient_phone",
        "g.expires_at",
        "g.redeemed_at",
        "g.seen_at",
        "g.created_at",
        "sender.name as sender_user_name",
        "sender.phone as sender_phone",
      ])
      .orderBy("g.created_at", "desc")
      .limit(Number(limit));

    if (status && status !== "all") {
      query = query.where("g.status", status);
    }

    if (search) {
      query = query.where(function () {
        this.whereILike("g.code", `%${search}%`)
          .orWhereILike("g.recipient_phone", `%${search}%`)
          .orWhereILike("g.sender_name", `%${search}%`)
          .orWhereILike("sender.name", `%${search}%`)
          .orWhereILike("sender.phone", `%${search}%`);
      });
    }

    const rows = await query;

    res.json({
      data: rows.map((g) => ({
        ...g,
        amount_aed: Number(g.amount_aed || 0),
        subtotal_aed: Number(g.subtotal_aed || 0),
        gift_fee_aed: Number(g.gift_fee_aed || 0),
        total_aed: Number(g.total_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/salon/gifts/:id
router.get("/:id", async (req, res, next) => {
  try {
    const salonId = getSalonId(req);
    const { id } = req.params;

    if (!salonId) {
      return res.status(400).json({ error: "Salon account is not linked to a salon" });
    }

    const gift = await db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .where("g.id", id)
      .where("g.salon_id", salonId)
      .select([
        "g.id",
        "g.code",
        "g.amount_aed",
        "g.subtotal_aed",
        "g.gift_fee_aed",
        "g.total_aed",
        "g.currency",
        "g.status",
        "g.sender_name",
        "g.message",
        "g.theme_id",
        "g.recipient_phone",
        "g.expires_at",
        "g.redeemed_at",
        "g.seen_at",
        "g.created_at",
        "sender.name as sender_user_name",
        "sender.phone as sender_phone",
      ])
      .first();

    if (!gift) {
      return res.status(404).json({ error: "Gift not found" });
    }

    res.json({
      gift: {
        ...gift,
        amount_aed: Number(gift.amount_aed || 0),
        subtotal_aed: Number(gift.subtotal_aed || 0),
        gift_fee_aed: Number(gift.gift_fee_aed || 0),
        total_aed: Number(gift.total_aed || 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;