const pool = require('../config/db');
const { employeeListPdf } = require('../utils/pdf');
const { validationResult } = require('express-validator');
const path = require('path');

exports.createEmployee = async (req, res) => {
  // any validation errors?
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ ok:false, errors: errors.array() });

  const {
    employee_code, full_name, email, phone, department_id,
    designation, status, joining_date, address, emergency_contact
  } = req.body;

  const profile_photo_path = req.files?.profilePhoto?.[0]?.path?.replace(/\\/g,'/');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO employees
        (employee_code, full_name, email, phone, department_id, designation, status, joining_date,
         address, emergency_contact, profile_photo_path, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_code || null, full_name, email || null, phone || null,
        department_id || null, designation || null, status || 'Active',
        joining_date || null, address || null, emergency_contact || null,
        profile_photo_path || null, req.user.id
      ]
    );

    const employeeId = result.insertId;

    // handle documents 
    const docs = req.files?.documents || [];
    for (const f of docs) {
      await conn.query(
        'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
        [employeeId, f.originalname, f.path.replace(/\\/g,'/'), f.mimetype]
      );
    }

    await conn.commit();
    res.status(201).json({ ok:true, id: employeeId, message: 'Employee created' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ ok:false, message: 'Failed to create employee' });
  } finally {
    conn.release();
  }
};

exports.getEmployees = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
  const offset = (page - 1) * pageSize;

  const search = (req.query.search || '').trim();
  const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
  const status = req.query.status || null;

  const filters = [];
  const params = [];

  if (search) {
    filters.push('(e.full_name LIKE ? OR e.email LIKE ? OR e.employee_code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (departmentId) { filters.push('e.department_id = ?'); params.push(departmentId); }
  if (status) { filters.push('e.status = ?'); params.push(status); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ count }]] = await pool.query(
    `SELECT COUNT(*) AS count FROM employees e ${where}`, params
  );

  res.json({
    ok: true,
    page, pageSize, total: count, data: rows
  });
};

exports.getEmployeeById = async (req, res) => {
  const id = Number(req.params.id);
  const [[emp]] = await pool.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = ?`, [id]
  );
  if (!emp) return res.status(404).json({ ok:false, message: 'Not found' });

  const [docs] = await pool.query(
    'SELECT id, file_name, file_path, file_type, uploaded_at FROM employee_documents WHERE employee_id = ?',
    [id]
  );
  emp.documents = docs;
  res.json({ ok:true, data: emp });
};

exports.updateEmployee = async (req, res) => {
  const id = Number(req.params.id);

  const {
    employee_code, full_name, email, phone, department_id,
    designation, status, joining_date, address, emergency_contact
  } = req.body;

  const profile_photo_path = req.files?.profilePhoto?.[0]?.path?.replace(/\\/g,'/');

  const [r] = await pool.query(
    `UPDATE employees SET
     employee_code = COALESCE(?, employee_code),
     full_name = COALESCE(?, full_name),
     email = COALESCE(?, email),
     phone = COALESCE(?, phone),
     department_id = COALESCE(?, department_id),
     designation = COALESCE(?, designation),
     status = COALESCE(?, status),
     joining_date = COALESCE(?, joining_date),
     address = COALESCE(?, address),
     emergency_contact = COALESCE(?, emergency_contact),
     profile_photo_path = COALESCE(?, profile_photo_path)
     WHERE id = ?`,
    [
      employee_code, full_name, email, phone, department_id,
      designation, status, joining_date, address, emergency_contact,
      profile_photo_path, id
    ]
  );
  if (!r.affectedRows) return res.status(404).json({ ok:false, message: 'Not found' });

  //  new documents
  const docs = req.files?.documents || [];
  for (const f of docs) {
    await pool.query(
      'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
      [id, f.originalname, f.path.replace(/\\/g,'/'), f.mimetype]
    );
  }

  res.json({ ok:true, message: 'Updated' });
};

exports.deleteEmployee = async (req, res) => {
  const id = Number(req.params.id);
  const [r] = await pool.query('DELETE FROM employees WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ ok:false, message: 'Not found' });
  res.json({ ok:true, message: 'Deleted' });
};

exports.exportEmployees = async (req, res) => {
  const format = (req.query.format || 'pdf').toLowerCase();
  const [rows] = await pool.query(
    `SELECT e.employee_code, e.full_name, d.name AS department_name, e.designation, e.status, e.joining_date
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.full_name ASC`
  );
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.write('employee_code,full_name,department,designation,status,joining_date\n');
    rows.forEach(r => {
      res.write([
        r.employee_code || '',
        `"${(r.full_name || '').replace(/"/g,'""')}"`,
        `"${(r.department_name || '').replace(/"/g,'""')}"`,
        `"${(r.designation || '').replace(/"/g,'""')}"`,
        r.status || '',
        r.joining_date ? new Date(r.joining_date).toISOString().slice(0,10) : ''
      ].join(',') + '\n');
    });
    return res.end();
  }

  // default: PDF
  return employeeListPdf(rows, res);
};
