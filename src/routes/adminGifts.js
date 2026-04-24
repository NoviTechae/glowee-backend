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

// GET /dashboard/admin/gifts/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total_gifts }] = await db("gifts").count("* as total_gifts");

    const [{ active_gifts }] = await db("gifts")
      .where("status", "active")
      .count("* as active_gifts");

    const [{ redeemed_gifts }] = await db("gifts")
      .where("status", "redeemed")
      .count("* as redeemed_gifts");

    const [{ expired_gifts }] = await db("gifts")
      .where("status", "expired")
      .count("* as expired_gifts");

    const [{ cancelled_gifts }] = await db("gifts")
      .where("status", "cancelled")
      .count("* as cancelled_gifts");

    const [{ total_amount }] = await db("gifts").sum("amount_aed as total_amount");

    res.json({
      total_gifts: Number(total_gifts || 0),
      active_gifts: Number(active_gifts || 0),
      redeemed_gifts: Number(redeemed_gifts || 0),
      expired_gifts: Number(expired_gifts || 0),
      cancelled_gifts: Number(cancelled_gifts || 0),
      total_amount: Number(total_amount || 0),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/gifts
router.get("/", async (req, res, next) => {
  try {
    const { search, status, limit = 100 } = req.query;

    let query = db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .leftJoin("users as receiver", "receiver.id", "g.receiver_user_id")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .select([
        "g.id",
        "g.type",
        "g.amount_aed",
        "g.service_id",
        "g.salon_id",
        "g.status",
        "g.message",
        "g.recipient_phone",
        "g.recipient_name",
        "g.expires_at",
        "g.redeemed_at",
        "g.created_at",
        "sender.name as sender_name",
        "sender.phone as sender_phone",
        "receiver.name as receiver_name",
        "receiver.phone as receiver_phone",
        "s.name as salon_name",
      ])
      .orderBy("g.created_at", "desc")
      .limit(Number(limit));

    if (status && status !== "all") {
      query = query.where("g.status", status);
    }

    if (search) {
      query = query.where(function () {
        this.whereILike("sender.name", `%${search}%`)
          .orWhereILike("sender.phone", `%${search}%`)
          .orWhereILike("receiver.name", `%${search}%`)
          .orWhereILike("receiver.phone", `%${search}%`)
          .orWhereILike("g.recipient_phone", `%${search}%`)
          .orWhereILike("g.recipient_name", `%${search}%`)
          .orWhereILike("g.id", `%${search}%`);
      });
    }

    const rows = await query;

    res.json({
      data: rows.map((g) => ({
        ...g,
        amount_aed: Number(g.amount_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/gifts/export
router.get("/export", async (req, res, next) => {
  try {
    const { search, status } = req.query;

    let query = db("gifts as g")
      .leftJoin("users as sender", "sender.id", "g.sender_user_id")
      .leftJoin("users as receiver", "receiver.id", "g.receiver_user_id")
      .leftJoin("salons as s", "s.id", "g.salon_id")
      .select([
        "g.id",
        "g.type",
        "g.amount_aed",
        "g.status",
        "g.message",
        "g.recipient_name",
        "g.recipient_phone",
        "g.expires_at",
        "g.redeemed_at",
        "g.created_at",
        "sender.name as sender_name",
        "sender.phone as sender_phone",
        "receiver.name as receiver_name",
        "receiver.phone as receiver_phone",
        "s.name as salon_name",
      ])
      .orderBy("g.created_at", "desc");

    if (status && status !== "all") {
      query = query.where("g.status", status);
    }

    if (search) {
      query = query.where(function () {
        this.whereILike("sender.name", `%${search}%`)
          .orWhereILike("sender.phone", `%${search}%`)
          .orWhereILike("receiver.name", `%${search}%`)
          .orWhereILike("receiver.phone", `%${search}%`)
          .orWhereILike("g.recipient_phone", `%${search}%`)
          .orWhereILike("g.recipient_name", `%${search}%`)
          .orWhereILike("g.id", `%${search}%`);
      });
    }

    const rows = await query;

    const headers = [
      "Gift ID",
      "Type",
      "Amount AED",
      "Status",
      "Sender Name",
      "Sender Phone",
      "Receiver Name",
      "Receiver Phone",
      "Recipient Name",
      "Recipient Phone",
      "Salon",
      "Message",
      "Expires At",
      "Redeemed At",
      "Created At",
    ];

    const csvRows = rows.map((g) => [
      g.id,
      g.type || "",
      Number(g.amount_aed || 0),
      g.status || "",
      g.sender_name || "",
      g.sender_phone || "",
      g.receiver_name || "",
      g.receiver_phone || "",
      g.recipient_name || "",
      g.recipient_phone || "",
      g.salon_name || "",
      g.message || "",
      g.expires_at || "",
      g.redeemed_at || "",
      g.created_at || "",
    ]);

    const escapeCsv = (value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csv = [
      headers.map(escapeCsv).join(","),
      ...csvRows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const fileName = `gifts-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

module.exports = router;