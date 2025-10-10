const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate'); // your existing handler
const upload = require('../middleware/upload');
const ctrl = require('../controllers/employee.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('HR'));

const addValidations = [
  body('full_name').isString().isLength({ min: 2 }),
  body('email').optional({ nullable: true }).isEmail(),
  body('phone').optional({ nullable: true }).isString(),
  body('department_id').optional({ nullable: true }).isInt(),
  body('joining_date').optional({ nullable: true }).isISO8601(),
];

const updateValidations = [
  body('full_name').optional().isString().isLength({ min: 2 }),
  body('email').optional({ nullable: true }).isEmail(),
  body('phone').optional({ nullable: true }).isString(),
  body('department_id').optional({ nullable: true }).isInt(),
  body('joining_date').optional({ nullable: true }).isISO8601(),
];

const uploadFields = upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'documents', maxCount: 10 }
]);

router.post('/', uploadFields, addValidations, validate, ctrl.createEmployee);
router.get('/', ctrl.getEmployees);
router.get('/:id', ctrl.getEmployeeById);
router.put('/:id', uploadFields, updateValidations, validate, ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
