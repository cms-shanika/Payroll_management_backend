// src/controllers/etfEpf.controller.js
const pool = require('../config/db');
const logAudit = require('../utils/audit');
const logEvent = require('../utils/event');

// ===================== ETF/EPF MANAGEMENT =====================

// Get all employees with ETF/EPF details
const getEtfEpfRecords = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        e.id AS employee_id,
        e.employee_code,
        e.full_name,
        e.designation,
        e.created_at AS emp_created_at, 
        d.name AS department,
        e.epf_no AS employee_epf_no,
        ee.epf_number AS etf_epf_epf_number,
        ee.etf_number,
        ee.epf_effective_date,
        ee.etf_effective_date,
        ee.epf_status,
        ee.etf_status,
        ee.epf_contribution_rate,
        ee.employer_epf_rate,
        ee.etf_contribution_rate,
        ee.id AS etf_epf_id,
        ee.created_at,
        ee.updated_at,
        CASE 
          WHEN ee.id IS NOT NULL THEN 'Yes' 
          ELSE 'No' 
        END AS has_etf_epf_record
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN employee_etf_epf ee ON ee.employee_id = e.id
      WHERE e.status = 'Active'
      ORDER BY e.full_name
    `);

    // Transform data: Force effective dates to be emp_created_at if null
    const transformedData = rows.map(row => ({
      id: row.etf_epf_id || null,
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      full_name: row.full_name,
      designation: row.designation,
      department: row.department,
      
      epf_number: row.etf_epf_epf_number || row.employee_epf_no,
      etf_number: row.etf_number,
      
      // LOGIC CHANGE: If specific effective date is null, use employee creation date
      epf_effective_date: row.epf_effective_date || row.emp_created_at,
      etf_effective_date: row.etf_effective_date || row.emp_created_at,
      
      epf_status: row.epf_status || 'Not Set',
      etf_status: row.etf_status || 'Not Set',
      epf_contribution_rate: row.epf_contribution_rate,
      employer_epf_rate: row.employer_epf_rate,
      etf_contribution_rate: row.etf_contribution_rate,
      has_etf_epf_record: row.has_etf_epf_record
    }));

    res.json({ ok: true, data: transformedData });
  } catch (err) {
    console.error('getEtfEpfRecords error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch ETF/EPF records' });
  }
};

// Get Payment History for View Button
const getEmployeePaymentHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;
    // Assumes payroll_cycles table exists. Returns empty array if query fails (table missing).
    const [rows] = await pool.query(`
      SELECT 
        id,
        period_year,
        period_month,
        generated_at as payment_date,
        total_deductions, -- You might need to split this if EPF is stored separately in your schema
        net_salary
      FROM payroll_cycles
      WHERE employee_id = ?
      ORDER BY period_year DESC, period_month DESC
    `, [employeeId]).catch(() => []); 

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('getHistory error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch history' });
  }
};

// Get ETF/EPF record by ID
const getEtfEpfById = async (req, res) => {
  try {
    const { id } = req.params;
    const [[record]] = await pool.query(`
      SELECT ee.*, e.full_name, e.employee_code, e.epf_no AS employee_epf_no, d.name AS department
      FROM employee_etf_epf ee
      JOIN employees e ON e.id = ee.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE ee.id = ?
    `, [id]);

    if (!record) return res.status(404).json({ ok: false, message: 'Not found' });
    res.json({ ok: true, data: record });
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Failed to fetch record' });
  }
};

// Create ETF/EPF record
const createEtfEpfRecord = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      employee_id, epf_number, etf_number, 
      epf_effective_date, etf_effective_date,
      epf_status = 'Active', etf_status = 'Active',
      epf_contribution_rate = 8.00, employer_epf_rate = 12.00, etf_contribution_rate = 3.00
    } = req.body;

    if (!employee_id) return res.status(400).json({ ok: false, message: 'Employee ID required' });

    await conn.beginTransaction();

    const [[existing]] = await conn.query('SELECT id FROM employee_etf_epf WHERE employee_id = ?', [employee_id]);
    if (existing) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: 'Record already exists' });
    }

    const [[emp]] = await conn.query('SELECT epf_no, created_at FROM employees WHERE id = ?', [employee_id]);
    const finalEpf = epf_number || emp?.epf_no;
    
    // Fallback to created_at if dates are missing
    const finalEpfDate = epf_effective_date || (emp ? emp.created_at : null);
    const finalEtfDate = etf_effective_date || (emp ? emp.created_at : null);

    if (!finalEpf) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: 'EPF number required' });
    }

    const [resIns] = await conn.query(
      `INSERT INTO employee_etf_epf 
       (employee_id, epf_number, etf_number, epf_effective_date, etf_effective_date, 
        epf_status, etf_status, epf_contribution_rate, employer_epf_rate, etf_contribution_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, finalEpf, etf_number, finalEpfDate, finalEtfDate, epf_status, etf_status, epf_contribution_rate, employer_epf_rate, etf_contribution_rate]
    );

    await conn.commit();
    logAudit({ user_id: req.user.id, action_type: "CREATE_ETF_EPF", target_table: "employee_etf_epf", target_id: resIns.insertId, before_state: null, after_state: req.body, req, status: "SUCCESS" });
    res.json({ ok: true, message: 'Created successfully', id: resIns.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, message: 'Failed to create' });
  } finally {
    conn.release();
  }
};

// Update ETF/EPF record
const updateEtfEpfRecord = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      epf_number, etf_number, epf_effective_date, etf_effective_date,
      epf_status, etf_status, epf_contribution_rate, employer_epf_rate, etf_contribution_rate
    } = req.body;

    await conn.beginTransaction();
    const [[before]] = await conn.query('SELECT * FROM employee_etf_epf WHERE id = ?', [id]);
    if (!before) { await conn.rollback(); return res.status(404).json({ ok: false }); }

    await conn.query(
      `UPDATE employee_etf_epf 
       SET epf_number = COALESCE(?, epf_number), 
           etf_number = COALESCE(?, etf_number), 
           epf_effective_date = COALESCE(?, epf_effective_date), 
           etf_effective_date = COALESCE(?, etf_effective_date),
           epf_status = COALESCE(?, epf_status), 
           etf_status = COALESCE(?, etf_status),
           epf_contribution_rate = COALESCE(?, epf_contribution_rate),
           employer_epf_rate = COALESCE(?, employer_epf_rate),
           etf_contribution_rate = COALESCE(?, etf_contribution_rate),
           updated_at = NOW()
       WHERE id = ?`,
      [epf_number, etf_number, epf_effective_date, etf_effective_date, epf_status, etf_status, epf_contribution_rate, employer_epf_rate, etf_contribution_rate, id]
    );

    await conn.commit();
    logAudit({ user_id: req.user.id, action_type: "UPDATE_ETF_EPF", target_table: "employee_etf_epf", target_id: id, before_state: before, after_state: req.body, req, status: "SUCCESS" });
    res.json({ ok: true, message: 'Updated successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, message: 'Failed to update' });
  } finally {
    conn.release();
  }
};

// Delete
const deleteEtfEpfRecord = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    await conn.beginTransaction();
    const [[record]] = await conn.query('SELECT * FROM employee_etf_epf WHERE id = ?', [id]);
    if (!record) { await conn.rollback(); return res.status(404).json({ok:false}); }
    await conn.query('DELETE FROM employee_etf_epf WHERE id = ?', [id]);
    await conn.commit();
    logAudit({ user_id: req.user.id, action_type: "DELETE_ETF_EPF", target_table: "employee_etf_epf", target_id: id, before_state: record, after_state: null, req, status: "SUCCESS" });
    res.json({ ok: true, message: 'Deleted' });
  } catch(e) {
    await conn.rollback(); res.status(500).json({ok:false});
  } finally { conn.release(); }
};

// Calculate
const calculateContributions = async (req, res) => {
  try {
    const { employeeId, basicSalary } = req.body;
    if (!employeeId || !basicSalary) return res.status(400).json({ ok: false });

    const [[rec]] = await pool.query(`SELECT epf_contribution_rate, employer_epf_rate, etf_contribution_rate FROM employee_etf_epf WHERE employee_id = ?`, [employeeId]);
    if (!rec) return res.status(404).json({ ok: false, message: 'No record found' });

    const basic = Number(basicSalary);
    const employeeEpf = (basic * rec.epf_contribution_rate) / 100;
    const employerEpf = (basic * rec.employer_epf_rate) / 100;
    const employerEtf = (basic * rec.etf_contribution_rate) / 100;

    res.json({ ok: true, data: { basic_salary: basic, employee_epf_contribution: employeeEpf.toFixed(2), employer_epf_contribution: employerEpf.toFixed(2), employer_etf_contribution: employerEtf.toFixed(2), total_epf: (employeeEpf+employerEpf).toFixed(2) }});
  } catch (err) {
    res.status(500).json({ ok: false });
  }
};

const getEmployeesWithoutEtfEpf = async (req, res) => {
  const [rows] = await pool.query("SELECT id, full_name FROM employees");
  res.json({ok:true, data:rows});
};

module.exports = {
  getEtfEpfRecords,
  getEtfEpfById,
  createEtfEpfRecord,
  updateEtfEpfRecord,
  deleteEtfEpfRecord,
  getEmployeesWithoutEtfEpf,
  calculateContributions,
  getEmployeePaymentHistory
};