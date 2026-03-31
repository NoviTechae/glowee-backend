//src/routes/dashboard.js
const router = require("express").Router();

router.use("/admin", require("./dashboardAdmin"));
router.use("/salon", require("./dashboardSalon"));

module.exports = router;