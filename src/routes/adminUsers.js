// src/routes/adminUsers.js
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

// GET /dashboard/admin/users
router.get("/", async (req, res, next) => {
  try {
    const {
      search,
      status,
      sort = "created_desc",
      limit = 100,
    } = req.query;

    let query = db("users as u")
      .select([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.wallet_balance_aed",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        db.raw("COUNT(DISTINCT b.id) as total_bookings"),
        db.raw("COALESCE(SUM(b.total_aed),0) as total_spent_aed"),
        db.raw("MAX(b.scheduled_at) as last_booking_at"),
      ])
      .leftJoin("bookings as b", "b.user_id", "u.id")
      .groupBy("u.id")
      .limit(Number(limit));

    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`);
      });
    }

    if (status === "active") {
      query = query.where("u.is_blocked", false);
    }

    if (status === "blocked") {
      query = query.where("u.is_blocked", true);
    }

    if (sort === "created_desc") {
      query = query.orderBy("u.created_at", "desc");
    } else if (sort === "created_asc") {
      query = query.orderBy("u.created_at", "asc");
    } else if (sort === "spent_desc") {
      query = query.orderByRaw("COALESCE(SUM(b.total_aed),0) DESC");
    } else if (sort === "bookings_desc") {
      query = query.orderByRaw("COUNT(DISTINCT b.id) DESC");
    } else if (sort === "name_asc") {
      query = query.orderBy("u.name", "asc");
    }

    const rows = await query;

    res.json({
      data: rows.map((u) => ({
        ...u,
        wallet_balance_aed: Number(u.wallet_balance_aed || 0),
        total_bookings: Number(u.total_bookings || 0),
        total_spent_aed: Number(u.total_spent_aed || 0),
        is_active: Boolean(u.is_active),
        is_blocked: Boolean(u.is_blocked),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users/stats
router.get("/stats", async (req, res, next) => {
  try {
    const [{ total_users }] = await db("users").count("* as total_users");

    const [{ active_users }] = await db("users")
      .where({ is_blocked: false })
      .count("* as active_users");

    const [{ blocked_users }] = await db("users")
      .where({ is_blocked: true })
      .count("* as blocked_users");

    const [{ new_this_month }] = await db("users")
      .whereRaw(
        "DATE_TRUNC('month', created_at)=DATE_TRUNC('month', CURRENT_DATE)"
      )
      .count("* as new_this_month");

    res.json({
      total_users: Number(total_users),
      active_users: Number(active_users),
      blocked_users: Number(blocked_users),
      new_this_month: Number(new_this_month),
    });
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users/export
router.get("/export", async (req, res, next) => {
  try {
    const {
      search,
      status,
      sort = "created_desc",
    } = req.query;

    let query = db("users as u")
      .select([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.wallet_balance_aed",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        db.raw("COUNT(DISTINCT b.id) as total_bookings"),
        db.raw("COALESCE(SUM(b.total_aed),0) as total_spent_aed"),
        db.raw("MAX(b.scheduled_at) as last_booking_at"),
      ])
      .leftJoin("bookings as b", "b.user_id", "u.id")
      .groupBy("u.id");

    // Search filter
    if (search) {
      query = query.where(function () {
        this.whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("u.email", `%${search}%`);
      });
    }

    // Status filter
    if (status === "active") {
      query = query.where("u.is_blocked", false);
    }

    if (status === "blocked") {
      query = query.where("u.is_blocked", true);
    }

    // Sort
    if (sort === "created_desc") {
      query = query.orderBy("u.created_at", "desc");
    } else if (sort === "created_asc") {
      query = query.orderBy("u.created_at", "asc");
    } else if (sort === "spent_desc") {
      query = query.orderByRaw("COALESCE(SUM(b.total_aed),0) DESC");
    } else if (sort === "bookings_desc") {
      query = query.orderByRaw("COUNT(DISTINCT b.id) DESC");
    } else if (sort === "name_asc") {
      query = query.orderBy("u.name", "asc");
    }

    const rows = await query;

    const headers = [
      "User ID",
      "Name",
      "Phone",
      "Email",
      "Wallet Balance AED",
      "Is Active",
      "Is Blocked",
      "Total Bookings",
      "Total Spent AED",
      "Last Booking At",
      "Created At",
    ];

    const csvRows = rows.map((u) => [
      u.id,
      u.name || "",
      u.phone || "",
      u.email || "",
      Number(u.wallet_balance_aed || 0),
      Boolean(u.is_active),
      Boolean(u.is_blocked),
      Number(u.total_bookings || 0),
      Number(u.total_spent_aed || 0),
      u.last_booking_at || "",
      u.created_at || "",
    ]);

    const escapeCsv = (value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csv = [
      headers.map(escapeCsv).join(","),
      ...csvRows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const fileName = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    res.send(csv);
  } catch (e) {
    next(e);
  }
});

// GET /dashboard/admin/users/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await db("users as u")
      .where("u.id", id)
      .select([
        "u.id",
        "u.name",
        "u.phone",
        "u.email",
        "u.wallet_balance_aed",
        "u.is_active",
        "u.is_blocked",
        "u.created_at",
        db.raw("COUNT(DISTINCT b.id) as total_bookings"),
        db.raw("COALESCE(SUM(b.total_aed),0) as total_spent_aed"),
        db.raw("MAX(b.scheduled_at) as last_booking_at"),
      ])
      .leftJoin("bookings as b", "b.user_id", "u.id")
      .groupBy("u.id")
      .first();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const bookings = await db("bookings as b")
      .where("b.user_id", id)
      .leftJoin("salons as s", "s.id", "b.salon_id")
      .leftJoin("branches as br", "br.id", "b.branch_id")
      .select([
        "b.id",
        "b.scheduled_at",
        "b.mode",
        "b.status",
        "b.total_aed",
        "b.created_at",
        "s.name as salon_name",
        "br.name as branch_name",
      ])
      .orderBy("b.created_at", "desc")
      .limit(20);

    res.json({
      user: {
        ...user,
        wallet_balance_aed: Number(user.wallet_balance_aed || 0),
        total_bookings: Number(user.total_bookings || 0),
        total_spent_aed: Number(user.total_spent_aed || 0),
      },
      bookings,
    });
  } catch (e) {
    next(e);
  }
});

// POST /dashboard/admin/users/:id/toggle-block
router.post("/:id/toggle-block", async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await db("users")
      .where({ id })
      .first(["id", "is_blocked"]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newStatus = !user.is_blocked;

    await db("users")
      .where({ id })
      .update({
        is_blocked: newStatus,
        updated_at: db.fn.now(),
      });

    res.json({
      ok: true,
      is_blocked: newStatus,
      message: `User ${newStatus ? "blocked" : "unblocked"} successfully`,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;