// src/routes/adminPartnerRequests.js
// Mounted in dashboardAdmin.js at /dashboard/admin/partner-requests
const router = require("express").Router();
const { z } = require("zod");
const db = require("../db/knex");

const STATUSES = ["new", "contacted", "onboarded", "declined"];

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(requireAdmin);

// GET /dashboard/admin/partner-requests?status=new&search=...
router.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status || "");
    const search = String(req.query.search || "").trim();

    let q = db("partner_requests").orderBy("created_at", "desc").limit(500);

    if (STATUSES.includes(status)) q = q.where({ status });

    if (search) {
      const like = `%${search}%`;
      const cols = ["salon_name", "contact_name", "phone", "email", "city"];
      q = q.where((w) => {
        cols.forEach((col) => w.orWhereRaw(`${col} ILIKE ?`, [like]));
      });
    }

    const [rows, countRows] = await Promise.all([
      q,
      db("partner_requests").select("status").count("* as c").groupBy("status"),
    ]);

    const counts = { new: 0, contacted: 0, onboarded: 0, declined: 0 };
    for (const c of countRows) counts[c.status] = Number(c.c);

    res.json({ data: rows, counts });
  } catch (e) {
    next(e);
  }
});

const UpdateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  admin_note: z.string().max(2000).nullable().optional(),
});

// PATCH /dashboard/admin/partner-requests/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const patch = UpdateSchema.parse(req.body);

    const [updated] = await db("partner_requests")
      .where({ id: req.params.id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning("*");

    if (!updated) return res.status(404).json({ error: "Request not found" });

    res.json({ request: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;