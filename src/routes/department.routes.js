// src/routes/department.routes.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/department.controller');

const router = express.Router();
router.get('/', requireAuth, ctrl.list);
router.post('/', requireAuth, ctrl.create);
router.put('/:id', requireAuth, ctrl.update);
router.delete('/:id', requireAuth, ctrl.delete);
module.exports = router;
