// src/routes/leave.routes.js
const express = require('express');
const ctrl = require('../controllers/leave.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Protect all leave endpoints (HR only, like attendance)
router.use(requireAuth, requireRole('HR'));

// Leave requests
router.post('/requests', ctrl.createRequest);
router.get('/requests', ctrl.listRequests);
router.post('/requests/:id/decide', ctrl.decideRequest);

// Status / calendar / summary
router.get('/status', ctrl.statusList);
router.get('/calendar', ctrl.calendarFeed);
router.get('/summary', ctrl.summary);

// 🔹 Employee balances for EmployeeLeaves.jsx
router.get('/balances', ctrl.employeeBalances);

module.exports = router;
