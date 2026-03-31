// src/routes/salons.js
const express = require("express");
const router = express.Router();
const salonController = require("../controllers/salonController");

router.get("/", salonController.getSalons);
router.get("/:id", salonController.getSalonById);

router.get("/:salonId/branches", salonController.getBranchesBySalonId);
router.get("/:salonId/branches/:branchId", salonController.getBranchById);

// (اختياري للتوافق)
router.post("/:salonId/branches", salonController.createBranch);

module.exports = router;