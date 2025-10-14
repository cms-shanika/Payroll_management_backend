// src/routes/employee.routes.js
const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/employee.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// protect all employee routes (HR only)
router.use(requireAuth, requireRole('HR'));

const addValidations = [
  // minimal required
  body('first_name').isString().isLength({ min: 1 }),
  body('last_name').optional({ nullable: true }).isString(),
  body('email').isEmail(), // work email
  body('status').optional().isString(),
  // optional but typed
  body('dob').optional({ nullable: true }).isISO8601(),
  body('appointment_date').optional({ nullable: true }).isISO8601(),
  body('basic_salary').optional({ nullable: true }).isNumeric(),
];

const updateValidations = [
  body('email').optional({ nullable: true }).isEmail(),
  body('dob').optional({ nullable: true }).isISO8601(),
  body('appointment_date').optional({ nullable: true }).isISO8601(),
  body('basic_salary').optional({ nullable: true }).isNumeric(),
];

// accept profilePhoto + general documents + bankDocument
const uploadFields = upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'documents', maxCount: 10 },
  { name: 'bankDocument', maxCount: 1 }
]);

router.post('/', uploadFields, addValidations, validate, ctrl.createEmployee);
router.get('/', ctrl.getEmployees);
router.get('/:id', ctrl.getEmployeeById);
router.put('/:id', uploadFields, updateValidations, validate, ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
