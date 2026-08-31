// src/routes/adminPartnerFeedback.js

const router = require("express").Router();
const { z } = require("zod");

const db = require("../db/knex");
const dashboardAuthRequired = require(
  "../middleware/dashboardAuthRequired"
);

function requireAdmin(req, res, next) {
  if (req.dashboard?.role !== "admin") {
    return res.status(403).json({
      error: "Admin only",
    });
  }

  next();
}

router.use(
  dashboardAuthRequired,
  requireAdmin
);

const UpdateStatusSchema = z.object({
  status: z.enum([
    "new",
    "reviewing",
    "planned",
    "completed",
    "declined",
  ]),
});

// GET /dashboard/admin/partner-feedback
router.get("/", async (req, res, next) => {
  try {
    const { status, type } = req.query;

    let query = db("partner_feedback as pf")
      .leftJoin(
        "salons as s",
        "s.id",
        "pf.salon_id"
      )
      .select([
        "pf.id",
        "pf.salon_id",
        "s.name as salon_name",
        "pf.type",
        "pf.title",
        "pf.message",
        "pf.status",
        "pf.created_at",
        "pf.updated_at",
      ])
      .orderBy(
        "pf.created_at",
        "desc"
      );

    if (
      status &&
      status !== "all"
    ) {
      query = query.where(
        "pf.status",
        status
      );
    }

    if (
      type &&
      type !== "all"
    ) {
      query = query.where(
        "pf.type",
        type
      );
    }

    const rows = await query;

    res.json({
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /dashboard/admin/partner-feedback/:id/status
router.patch(
  "/:id/status",
  async (req, res, next) => {
    try {
      const parsed =
        UpdateStatusSchema.safeParse(
          req.body
        );

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid status",
          details:
            parsed.error.flatten(),
        });
      }

      const [row] = await db(
        "partner_feedback"
      )
        .where({
          id: req.params.id,
        })
        .update({
          status:
            parsed.data.status,
          updated_at:
            db.fn.now(),
        })
        .returning([
          "id",
          "salon_id",
          "type",
          "title",
          "message",
          "status",
          "created_at",
          "updated_at",
        ]);

      if (!row) {
        return res.status(404).json({
          error:
            "Feedback not found",
        });
      }

      res.json({
        feedback: row,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;