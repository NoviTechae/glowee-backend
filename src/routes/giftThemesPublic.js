//src/routes/giftThemesPublic.js
const router = require("express").Router();
const db = require("../db/knex");

// GET /gift/themes - Public endpoint for mobile app
router.get("/themes", async (req, res, next) => {
  try {
    // Only return active themes, sorted by sort_order
    const themes = await db("gift_themes")
      .where({ is_active: true })
      .select([
        "id",
        "title",
        "category",
        "front_image_url",
        "back_image_url",
        "sort_order",
      ])
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "desc");

    res.json({ 
      ok: true, 
      data: themes 
    });
  } catch (error) {
    console.error("Error fetching gift themes:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /gift/themes/:id - Get single theme (for preview)
router.get("/themes/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const theme = await db("gift_themes")
      .where({ id, is_active: true })
      .select([
        "id",
        "title",
        "category",
        "front_image_url",
        "back_image_url",
      ])
      .first();

    if (!theme) {
      return res.status(404).json({ 
        ok: false, 
        error: "Theme not found" 
      });
    }

    res.json({ 
      ok: true, 
      data: theme 
    });
  } catch (error) {
    console.error("Error fetching gift theme:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});


module.exports = router;