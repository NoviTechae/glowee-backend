const router = require("express").Router();
const authRequired = require("../middleware/authRequired");
const addressController = require("../controllers/addressController");

router.get("/", authRequired, addressController.listMyAddresses);
router.post("/", authRequired, addressController.createMyAddress);
router.patch("/:id", authRequired, addressController.updateMyAddress);
router.delete("/:id", authRequired, addressController.deleteMyAddress);
router.post("/:id/default", authRequired, addressController.setDefaultAddress);

module.exports = router;