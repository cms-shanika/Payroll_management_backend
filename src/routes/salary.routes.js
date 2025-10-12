const express = require('express');
const ctrl = require('../controllers/salary.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only HR can configure salaries
router.use(requireAuth, requireRole('HR'));

router.post('/basic', ctrl.setBasicSalary);
router.post('/allowance', ctrl.addAllowance);
router.get('/allowances', ctrl.listAllowance)            //new
router.post('/deduction', ctrl.addDeduction);
router.get('/deductions', ctrl.listDeductions);          //new
router.post('/overtime', ctrl.addOvertimeAdjustment);
router.get('/overtime',ctrl.listOvertime);                 //new
router.post('/bonus', ctrl.addBonus);                      //new
router.get('/earnings', ctrl.listEarnings);                //new (grid)
router.get('/summary', ctrl.monthSummary);                //new (net salary summary)
router.post('/run', ctrl.runPayrollForMonth);             //new (bulk run)
router.get('/payslip', ctrl.generatePayslip);

module.exports = router;
