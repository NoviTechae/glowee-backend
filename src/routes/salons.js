// src/routes/salons.js
const express = require("express");
const router = express.Router();
const salonController = require("../controllers/salonController");
const searchController = require("../controllers/searchController");

router.get("/", salonController.getSalons);

router.get("/search/popular", searchController.getPopularSearches);
router.get("/search", salonController.searchSalons);

router.get("/:id", salonController.getSalonById);

router.get("/:salonId/branches", salonController.getBranchesBySalonId);
router.get("/:salonId/branches/:branchId", salonController.getBranchById);

router.post("/:salonId/branches", salonController.createBranch);

module.exports = router;