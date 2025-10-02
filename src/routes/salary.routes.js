const express = require('express');
const ctrl = require('../controllers/salary.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only HR can configure salaries
router.use(requireAuth, requireRole('HR'));

router.post('/basic', ctrl.setBasicSalary);
router.post('/allowance', ctrl.addAllowance);
router.post('/deduction', ctrl.addDeduction);
router.post('/overtime', ctrl.addOvertimeAdjustment);
router.get('/payslip', ctrl.generatePayslip);

module.exports = router;
