const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/employee.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only HR can manage employees
router.use(requireAuth, requireRole('HR'));

const addValidations = [
  body('full_name').isString().isLength({ min: 2 }).withMessage('Full name required'),
  body('email').optional({ nullable: true }).isEmail().withMessage('Invalid email'),
  body('phone').optional({ nullable: true }).isString(),
  body('department_id').optional({ nullable: true }).isInt(),
  body('joining_date').optional({ nullable: true }).isISO8601().toDate(),
];

// single photo + multiple docs
const uploadFields = upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'documents', maxCount: 10 }
]);

router.post('/', uploadFields, addValidations, validate, ctrl.createEmployee);
router.get('/', ctrl.getEmployees);
router.get('/export', ctrl.exportEmployees);
router.get('/:id', ctrl.getEmployeeById);
router.put('/:id', uploadFields, addValidations, validate, ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
