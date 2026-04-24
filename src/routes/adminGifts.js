// src/routes/adminGifts.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired, requireAdmin);

router.get("/stats", async (req, res, next) => {
  try {
    const [{ total_gifts }] = await db("gifts").count("* as total_gifts");
    const [{ active_gifts }] = await db("gifts").where("status", "active").count("* as active_gifts");
    const [{ redeemed_gifts }] = await db("gifts").where("status", "redeemed").count("* as redeemed_gifts");
    const [{ expired_gifts }] = await db("gifts").where("status", "expired").count("* as expired_gifts");
    const [{ cancelled_gifts }] = await db("gifts").where("status", "cancelled").count("* as cancelled_gifts");
    const [{ total_amount }] = await db("gifts").sum("total_aed as total_amount");
    const [{ total_fees }] = await db("gifts").sum("gift_fee_aed as total_fees");

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

router.get("/", async (req, res, next) => {
  try {
    const { search, status, limit = 100 } = req.query;

    let query = db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .leftJoin("salons as s", "s.id", "g.salon_id")
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
        "g.sender_seen_rewarded",
        "g.created_at",
        "sender.name as sender_user_name",
        "sender.phone as sender_phone",
        "sender.email as sender_email",
        "s.name as salon_name",
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
          .orWhereILike("sender.phone", `%${search}%`)
          .orWhereILike("sender.email", `%${search}%`)
          .orWhereILike("s.name", `%${search}%`);
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
        sender_seen_rewarded: Boolean(g.sender_seen_rewarded),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const gift = await db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .where("g.id", id)
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
        "g.sender_seen_rewarded",
        "g.created_at",
        "sender.name as sender_user_name",
        "sender.phone as sender_phone",
        "sender.email as sender_email",
        "s.name as salon_name",
      ])
      .first();

    if (!gift) {
      return res.status(404).json({ error: "Gift not found" });
    }

    const usageBooking = await db("bookings as b")
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .where("b.gift_id", id)
      .select([
        "b.id",
        "b.status",
        "b.mode",
        "b.scheduled_at",
        "b.total_aed",
        "b.created_at",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .first();

    res.json({
      gift: {
        ...gift,
        amount_aed: Number(gift.amount_aed || 0),
        subtotal_aed: Number(gift.subtotal_aed || 0),
        gift_fee_aed: Number(gift.gift_fee_aed || 0),
        total_aed: Number(gift.total_aed || 0),
        sender_seen_rewarded: Boolean(gift.sender_seen_rewarded),
      },

      usage_booking: usageBooking
        ? {
          ...usageBooking,
          total_aed: Number(usageBooking.total_aed || 0),
        }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;