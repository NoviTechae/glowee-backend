// src/routes/adminWallet.js
const router = require("express").Router();
const db = require("../db/knex");
const dashboardAuthRequired = require("../middleware/dashboardAuthRequired");

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(dashboardAuthRequired);
router.use(requireAdmin);

//
// GET /dashboard/admin/wallet/stats
//
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total_topups }] = await db("wallet_transactions")
      .where("type", "topup")
      .sum("amount_aed as total_topups");

    const [{ total_spent }] = await db("wallet_transactions")
      .where("type", "spent")
      .sum("amount_aed as total_spent");

    const [{ total_refunds }] = await db("wallet_transactions")
      .where("type", "refund")
      .sum("amount_aed as total_refunds");

    const [{ total_gifts_sent }] = await db("wallet_transactions")
      .where("type", "gift_sent")
      .sum("amount_aed as total_gifts_sent");

    const [{ total_gifts_received }] = await db("wallet_transactions")
      .where("type", "gift_received")
      .sum("amount_aed as total_gifts_received");

    res.json({
      total_topups: Number(total_topups || 0),
      total_spent: Number(total_spent || 0),
      total_refunds: Number(total_refunds || 0),
      total_gifts_sent: Number(total_gifts_sent || 0),
      total_gifts_received: Number(total_gifts_received || 0),
    });
  } catch (e) {
    next(e);
  }
});

//
// GET /dashboard/admin/wallet
//
router.get("/", async (req, res, next) => {
  try {
    const { search, type, limit = 100 } = req.query;

    let query = db("wallet_transactions as wt")
      .leftJoin("users as u", "u.id", "wt.user_id")
      .select([
        "wt.id",
        "wt.user_id",
        "wt.type",
        "wt.amount_aed",
        "wt.note",
        "wt.ref_id",
        "wt.created_at",
        "u.name as user_name",
        "u.phone as user_phone",
        "u.email as user_email",
      ])
      .orderBy("wt.created_at", "desc")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`)
          .orWhereILike("wt.id", `%${search}%`);
      });
    }

    if (type && type !== "all") {
      query = query.where("wt.type", type);
    }

    const rows = await query;

    res.json({
      data: rows.map((row) => ({
        ...row,
        amount_aed: Number(row.amount_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/wallet/users/:userId
router.get("/users/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await db("users as u")
      .leftJoin("wallets as w", "w.user_id", "u.id")
      .where("u.id", userId)
      .first([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        "w.balance_aed",
      ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const txRows = await db("wallet_transactions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .select([
        "id",
        "type",
        "amount_aed",
        "note",
        "ref_id",
        "created_at",
      ]);

    const grouped = txRows.reduce(
      (acc, row) => {
        const amount = Number(row.amount_aed || 0);

        if (row.type === "topup") acc.total_topups += amount;
        if (row.type === "spent") acc.total_spent += amount;
        if (row.type === "refund") acc.total_refunds += amount;
        if (row.type === "gift_sent") acc.total_gifts_sent += amount;
        if (row.type === "gift_received") acc.total_gifts_received += amount;

        return acc;
      },
      {
        total_topups: 0,
        total_spent: 0,
        total_refunds: 0,
        total_gifts_sent: 0,
        total_gifts_received: 0,
      }
    );

    res.json({
      user: {
        ...user,
        balance_aed: Number(user.balance_aed || 0),
      },
      stats: grouped,
      transactions: txRows.map((row) => ({
        ...row,
        amount_aed: Number(row.amount_aed || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;