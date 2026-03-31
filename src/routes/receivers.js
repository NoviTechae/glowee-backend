const express = require('express');
const router = express.Router();
const { getUserReceivers, addReceiver, deleteReceiver } = require('../controllers/receiverController');
const authRequired = require('../middleware/authRequired'); // المسار الصحيح

router.get("/", authRequired, getUserReceivers);
router.post("/", authRequired, addReceiver);
router.delete("/:phone", authRequired, deleteReceiver);

module.exports = router;