const express = require('express');
const ctrl = require('../controllers/salary.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// protect all salary endpoints
router.use(requireAuth, requireRole('HR'));

// basic salary
router.post('/basic', ctrl.setBasicSalary);
router.get('/basic', ctrl.getBasicSalary);

// allowances
router.post('/allowance', ctrl.addAllowance);
router.get('/allowances', ctrl.listAllowances);

// deductions
router.get('/deductions', ctrl.listDeductions);
router.post('/deductions', ctrl.createDeduction);

router.get('/deductions/:id', ctrl.getDeductionById);
router.put('/deductions/:id', ctrl.updateDeduction);
router.delete('/deductions/:id', ctrl.deleteDeduction);

// overtime / adjustments
router.post('/overtime', ctrl.addOvertimeAdjustment);
router.get('/overtime', ctrl.listOvertime);

// bonuses
router.post('/bonus', ctrl.addBonus);

// earnings grid
router.get('/earnings', ctrl.listEarnings);

// month summary / run payroll
router.get('/summary', ctrl.monthSummary);
router.post('/run', ctrl.runPayrollForMonth);

// payslip
router.get('/payslip', ctrl.generatePayslip);

module.exports = router;
