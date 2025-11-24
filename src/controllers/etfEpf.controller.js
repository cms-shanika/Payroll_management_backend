// src/controllers/etfEpf.controller.js
const pool = require('../config/db');
const logEvent = require('../services/logEvent');
const logAudit = require('../services/logAudit');

// ===================== ETF/EPF MANAGEMENT =====================

// Get all employees with ETF/EPF details (show all employees, even without ETF/EPF records)
const getEtfEpfRecords = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        e.id AS employee_id,
        e.employee_code,
        e.full_name,
        e.designation,
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

    // Transform the data for frontend
    const transformedData = rows.map(row => ({
      id: row.etf_epf_id || null, // This will be null for employees without ETF/EPF records
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      full_name: row.full_name,
      designation: row.designation,
      department: row.department,
      epf_number: row.etf_epf_epf_number || row.employee_epf_no, // Use employee's EPF no if no ETF/EPF record
      etf_number: row.etf_number,
      epf_effective_date: row.epf_effective_date,
      etf_effective_date: row.etf_effective_date,
      epf_status: row.epf_status || 'Not Set',
      etf_status: row.etf_status || 'Not Set',
      epf_contribution_rate: row.epf_contribution_rate,
      employer_epf_rate: row.employer_epf_rate,
      etf_contribution_rate: row.etf_contribution_rate,
      has_etf_epf_record: row.has_etf_epf_record,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    res.json({ ok: true, data: transformedData });
  } catch (err) {
    console.error('getEtfEpfRecords error:', err);
    logEvent({
      level: 'error',
      event_type: "GET_ETF_EPF_RECORDS_FAILED",
      user_id: req.user?.id || null,
      event_details: { error: err.message },
      status: "FAILURE"
    });
    res.status(500).json({ ok: false, message: 'Failed to fetch ETF/EPF records' });
  }
};

// Get ETF/EPF record by ID
const getEtfEpfById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [[record]] = await pool.query(`
      SELECT 
        ee.*,
        e.full_name,
        e.employee_code,
        e.epf_no AS employee_epf_no,
        d.name AS department,
        e.designation
      FROM employee_etf_epf ee
      JOIN employees e ON e.id = ee.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE ee.id = ?
    `, [id]);

    if (!record) {
      return res.status(404).json({ ok: false, message: 'ETF/EPF record not found' });
    }

    res.json({ ok: true, data: record });
  } catch (err) {
    console.error('getEtfEpfById error:', err);
    logEvent({
      level: 'error',
      event_type: "GET_ETF_EPF_BY_ID_FAILED",
      user_id: req.user?.id || null,
      event_details: { error: err.message, id: req.params.id },
      status: "FAILURE"
    });
    res.status(500).json({ ok: false, message: 'Failed to fetch ETF/EPF record' });
  }
};

// Create ETF/EPF record
const createEtfEpfRecord = async (req, res) => {
  const conn = await pool.getConnection();
  
  try {
    const {
      employee_id,
      epf_number,
      etf_number,
      epf_effective_date,
      etf_effective_date,
      epf_status = 'Active',
      etf_status = 'Active',
      epf_contribution_rate = 8.00,
      employer_epf_rate = 12.00,
      etf_contribution_rate = 3.00
    } = req.body;

    // Validate required fields
    if (!employee_id) {
      return res.status(400).json({ ok: false, message: 'Employee ID is required' });
    }

    await conn.beginTransaction();

    // Check if employee exists and get EPF number
    const [[employee]] = await conn.query(
      'SELECT id, full_name, epf_no FROM employees WHERE id = ?',
      [employee_id]
    );

    if (!employee) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'Employee not found' });
    }

    // Check if record already exists for this employee
    const [[existingRecord]] = await conn.query(
      'SELECT id FROM employee_etf_epf WHERE employee_id = ?',
      [employee_id]
    );

    if (existingRecord) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: 'ETF/EPF record already exists for this employee' });
    }

    // Use employee's EPF number if not provided
    const finalEpfNumber = epf_number || employee.epf_no;

    if (!finalEpfNumber) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: 'EPF number is required. Please provide EPF number or ensure employee has EPF number.' });
    }

    // Insert new record
    const [result] = await conn.query(
      `INSERT INTO employee_etf_epf 
       (employee_id, epf_number, etf_number, epf_effective_date, etf_effective_date, 
        epf_status, etf_status, epf_contribution_rate, employer_epf_rate, etf_contribution_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        finalEpfNumber,
        etf_number || null,
        epf_effective_date || null,
        etf_effective_date || null,
        epf_status,
        etf_status,
        epf_contribution_rate,
        employer_epf_rate,
        etf_contribution_rate
      ]
    );

    await conn.commit();

    // Audit log
    logAudit({
      user_id: req.user.id,
      action_type: "CREATE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: result.insertId,
      before_state: null,
      after_state: {
        employee_id,
        epf_number: finalEpfNumber,
        etf_number,
        epf_effective_date,
        etf_effective_date,
        epf_status,
        etf_status,
        epf_contribution_rate,
        employer_epf_rate,
        etf_contribution_rate
      },
      req,
      status: "SUCCESS"
    });

    res.json({ 
      ok: true, 
      message: 'ETF/EPF record created successfully',
      id: result.insertId
    });

  } catch (err) {
    await conn.rollback();
    console.error('createEtfEpfRecord error:', err);
    
    // Handle duplicate entry error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ ok: false, message: 'ETF or EPF number already exists' });
    }

    logAudit({
      user_id: req.user?.id || null,
      action_type: "CREATE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: null,
      before_state: null,
      after_state: req.body,
      req,
      status: "FAILURE",
      error_message: err.message
    });

    res.status(500).json({ ok: false, message: 'Failed to create ETF/EPF record' });
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
      epf_number,
      etf_number,
      epf_effective_date,
      etf_effective_date,
      epf_status,
      etf_status,
      epf_contribution_rate,
      employer_epf_rate,
      etf_contribution_rate
    } = req.body;

    await conn.beginTransaction();

    // Get record before update for audit
    const [[beforeRecord]] = await conn.query(
      `SELECT ee.*, e.epf_no AS employee_epf_no 
       FROM employee_etf_epf ee 
       JOIN employees e ON e.id = ee.employee_id 
       WHERE ee.id = ?`,
      [id]
    );

    if (!beforeRecord) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'ETF/EPF record not found' });
    }

    // Update record
    const [result] = await conn.query(
      `UPDATE employee_etf_epf 
       SET epf_number = ?, etf_number = ?, 
           epf_effective_date = ?, etf_effective_date = ?,
           epf_status = ?, etf_status = ?,
           epf_contribution_rate = ?, employer_epf_rate = ?, etf_contribution_rate = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        epf_number !== undefined ? epf_number : beforeRecord.epf_number,
        etf_number !== undefined ? etf_number : beforeRecord.etf_number,
        epf_effective_date !== undefined ? epf_effective_date : beforeRecord.epf_effective_date,
        etf_effective_date !== undefined ? etf_effective_date : beforeRecord.etf_effective_date,
        epf_status !== undefined ? epf_status : beforeRecord.epf_status,
        etf_status !== undefined ? etf_status : beforeRecord.etf_status,
        epf_contribution_rate !== undefined ? epf_contribution_rate : beforeRecord.epf_contribution_rate,
        employer_epf_rate !== undefined ? employer_epf_rate : beforeRecord.employer_epf_rate,
        etf_contribution_rate !== undefined ? etf_contribution_rate : beforeRecord.etf_contribution_rate,
        id
      ]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'ETF/EPF record not found' });
    }

    // Get updated record for audit
    const [[afterRecord]] = await conn.query(
      'SELECT * FROM employee_etf_epf WHERE id = ?',
      [id]
    );

    await conn.commit();

    // Audit log
    logAudit({
      user_id: req.user.id,
      action_type: "UPDATE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: id,
      before_state: beforeRecord,
      after_state: afterRecord,
      req,
      status: "SUCCESS"
    });

    res.json({ ok: true, message: 'ETF/EPF record updated successfully' });

  } catch (err) {
    await conn.rollback();
    console.error('updateEtfEpfRecord error:', err);
    
    // Handle duplicate entry error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ ok: false, message: 'ETF or EPF number already exists' });
    }

    logAudit({
      user_id: req.user?.id || null,
      action_type: "UPDATE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: req.params.id,
      before_state: null,
      after_state: req.body,
      req,
      status: "FAILURE",
      error_message: err.message
    });

    res.status(500).json({ ok: false, message: 'Failed to update ETF/EPF record' });
  } finally {
    conn.release();
  }
};

// Delete ETF/EPF record
const deleteEtfEpfRecord = async (req, res) => {
  const conn = await pool.getConnection();
  
  try {
    const { id } = req.params;

    await conn.beginTransaction();

    // Get record before deletion for audit
    const [[record]] = await conn.query(
      'SELECT * FROM employee_etf_epf WHERE id = ?',
      [id]
    );

    if (!record) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'ETF/EPF record not found' });
    }

    await conn.query('DELETE FROM employee_etf_epf WHERE id = ?', [id]);
    await conn.commit();

    // Audit log
    logAudit({
      user_id: req.user.id,
      action_type: "DELETE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: id,
      before_state: record,
      after_state: null,
      req,
      status: "SUCCESS"
    });

    res.json({ ok: true, message: 'ETF/EPF record deleted successfully' });

  } catch (err) {
    await conn.rollback();
    console.error('deleteEtfEpfRecord error:', err);
    
    logAudit({
      user_id: req.user?.id || null,
      action_type: "DELETE_ETF_EPF",
      target_table: "employee_etf_epf",
      target_id: req.params.id,
      before_state: null,
      after_state: null,
      req,
      status: "FAILURE",
      error_message: err.message
    });

    res.status(500).json({ ok: false, message: 'Failed to delete ETF/EPF record' });
  } finally {
    conn.release();
  }
};

// Get employees without ETF/EPF records (for dropdown)
const getEmployeesWithoutEtfEpf = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.id AS employee_id, e.full_name, e.epf_no, d.name AS department, e.designation
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'Active'
      AND e.id NOT IN (SELECT employee_id FROM employee_etf_epf)
      ORDER BY e.full_name
    `);

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('getEmployeesWithoutEtfEpf error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch employees without ETF/EPF' });
  }
};

// Calculate ETF/EPF contributions for an employee
const calculateContributions = async (req, res) => {
  try {
    const { employeeId, basicSalary } = req.body;

    if (!employeeId || !basicSalary) {
      return res.status(400).json({ ok: false, message: 'Employee ID and basic salary are required' });
    }

    // Get ETF/EPF record
    const [[etfEpfRecord]] = await pool.query(`
      SELECT epf_contribution_rate, employer_epf_rate, etf_contribution_rate
      FROM employee_etf_epf 
      WHERE employee_id = ? AND epf_status = 'Active' AND etf_status = 'Active'
    `, [employeeId]);

    if (!etfEpfRecord) {
      return res.status(404).json({ ok: false, message: 'No active ETF/EPF record found for employee' });
    }

    const basic = Number(basicSalary);
    const employeeEpf = (basic * etfEpfRecord.epf_contribution_rate) / 100;
    const employerEpf = (basic * etfEpfRecord.employer_epf_rate) / 100;
    const employerEtf = (basic * etfEpfRecord.etf_contribution_rate) / 100;
    const totalEpf = employeeEpf + employerEpf;

    res.json({
      ok: true,
      data: {
        basic_salary: basic,
        employee_epf_contribution: employeeEpf.toFixed(2),
        employer_epf_contribution: employerEpf.toFixed(2),
        employer_etf_contribution: employerEtf.toFixed(2),
        total_epf_contribution: totalEpf.toFixed(2),
        total_employer_contribution: (employerEpf + employerEtf).toFixed(2),
        rates: {
          employee_epf: etfEpfRecord.epf_contribution_rate,
          employer_epf: etfEpfRecord.employer_epf_rate,
          employer_etf: etfEpfRecord.etf_contribution_rate
        }
      }
    });

  } catch (err) {
    console.error('calculateContributions error:', err);
    res.status(500).json({ ok: false, message: 'Failed to calculate contributions' });
  }
};

module.exports = {
  getEtfEpfRecords,
  getEtfEpfById,
  createEtfEpfRecord,
  updateEtfEpfRecord,
  deleteEtfEpfRecord,
  getEmployeesWithoutEtfEpf,
  calculateContributions
};