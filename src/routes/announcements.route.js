const express = require('express');
const ctrl = require('../controllers/announcements.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Protect all attendance endpoints
// router.use(requireAuth, requireRole('HR'));


router.get("/", ctrl.getAll);
router.post("/", ctrl.create);
router.put("/:announcement_id", ctrl.update);
router.delete("/:announcement_id", ctrl.remove);

module.exports = router;