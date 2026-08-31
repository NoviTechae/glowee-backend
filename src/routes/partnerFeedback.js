// src/routes/partnerFeedback.js

const router = require("express").Router();
const { z } = require("zod");

const db = require("../db/knex");
const dashboardAuthRequired = require(
  "../middleware/dashboardAuthRequired"
);

function requireSalon(req, res, next) {
  if (req.dashboard?.role !== "salon") {
    return res.status(403).json({
      error: "Salon only",
    });
  }

  if (!req.dashboard?.salon_id) {
    return res.status(401).json({
      error: "Missing salon_id",
    });
  }

  next();
}

router.use(
  dashboardAuthRequired,
  requireSalon
);

const CreateFeedbackSchema = z.object({
  type: z.enum([
    "feature",
    "improvement",
    "problem",
    "other",
  ]),

  title: z
    .string()
    .trim()
    .min(3)
    .max(150),

  message: z
    .string()
    .trim()
    .min(5)
    .max(5000),
});

// GET /dashboard/salon/partner-feedback
router.get("/", async (req, res, next) => {
  try {
    const salonId =
      req.dashboard.salon_id;

    const rows = await db(
      "partner_feedback"
    )
      .where({
        salon_id: salonId,
      })
      .select([
        "id",
        "type",
        "title",
        "message",
        "status",
        "created_at",
        "updated_at",
      ])
      .orderBy("created_at", "desc");

    res.json({
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// POST /dashboard/salon/partner-feedback
router.post("/", async (req, res, next) => {
  try {
    const parsed =
      CreateFeedbackSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid feedback",
        details:
          parsed.error.flatten(),
      });
    }

    const salonId =
      req.dashboard.salon_id;

    const { type, title, message } =
      parsed.data;

    const [row] = await db(
      "partner_feedback"
    )
      .insert({
        salon_id: salonId,
        type,
        title,
        message,
        status: "new",
      })
      .returning([
        "id",
        "type",
        "title",
        "message",
        "status",
        "created_at",
        "updated_at",
      ]);

    res.status(201).json({
      feedback: row,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;