// src/controllers/employee.controller.js
const pool = require('../config/db');
// const { employeeListPdf } = require('../utils/pdf'); // optional
const path = require('path');

exports.createEmployee = async (req, res) => {
  const {
    employee_code, full_name, email, phone, department_id,
    designation, status, joining_date, address, emergency_contact
  } = req.body;

  // files from multer
  const profile_photo_path = req.files?.profilePhoto?.[0]?.path?.replace(/\\/g, '/');
  const docs = req.files?.documents || [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO employees
       (employee_code, full_name, email, phone, department_id, designation, status, joining_date,
        address, emergency_contact, profile_photo_path, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_code || null,
        full_name,
        email || null,
        phone || null,
        department_id ? Number(department_id) : null,
        designation || null,
        status || 'Active',
        joining_date || null,
        address || null,
        emergency_contact || null,
        profile_photo_path || null,
        (req.user && req.user.id) || 1
      ]
    );
    const employeeId = result.insertId;

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
  const [rows] = await pool.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.created_at DESC`
  );
  res.json({ ok:true, data: rows });
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
      employee_code, full_name, email, phone,
      department_id ? Number(department_id) : null, designation, status,
      joining_date, address, emergency_contact,
      profile_photo_path, id
    ]
  );

  if (!r.affectedRows) return res.status(404).json({ ok:false, message: 'Not found' });

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

exports.exportEmployees = async (_req, res) => {
  // simple CSV export (you can plug your PDF util back later)
  const [rows] = await pool.query(
    `SELECT e.employee_code, e.full_name, d.name AS department_name,
            e.designation, e.status, e.joining_date
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.full_name ASC`
  );

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
};
