// src/routes/me.js
const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const profileController = require("../controllers/profileController");

router.get("/profile", authRequired, profileController.getMyProfile);
router.put("/profile", authRequired, profileController.updateMyProfile);

router.get("/addresses", authRequired, profileController.getMyAddresses);
router.post("/addresses", authRequired, profileController.createMyAddress);
router.put("/addresses/:id", authRequired, profileController.updateMyAddress);
router.delete("/addresses/:id", authRequired, profileController.deleteMyAddress);

module.exports = router;