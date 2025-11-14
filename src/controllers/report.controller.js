const pool = require('../config/db');

const getMonthlyTotalData = async (req, res) => {
  try {
    // Get month/year from query or default to current
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    // Single query from the combined summary table
    const sql = `
      SELECT 
        SUM(total_net_salary) AS net_salary,
        SUM(total_allowances) AS allowances,
        SUM(total_deductions) AS deductions,
        SUM(total_bonuses) AS bonuses,
        SUM(total_reimbursements) AS reimbursements
      FROM department_financial_summary
      WHERE period_month = ? AND period_year = ?
    `;

    const [rows] = await pool.query(sql, [month, year]);
    const totals = rows?.[0] || {};

    res.json({
      period: `${year}-${String(month).padStart(2, '0')}`,
      net_salary: totals.net_salary || 0,
      allowances: totals.allowances || 0,
      deductions: totals.deductions || 0,
      bonuses: totals.bonuses || 0,
      reimbursements: totals.reimbursements || 0
    });

  } catch (err) {
    console.error("Error in getMonthlyTotalData:", err);
    res.status(500).json({ error: "Database query failed" });
  }
};

const getSalaryRange = async (req, res) => {
  try {
    const sql = `
      SELECT basic_salary
      FROM salaries;
    `;
    const [rows] = await pool.query(sql);
    res.json(rows.map(r => r.basic_salary));
  } catch (err) {
    console.error('Failed to fetch salaries:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
};

const compensateTrend = async (req, res) => {
  try {
    // Number of months from query, default to 6
    const months = parseInt(req.query.months, 10) || 6;

    const sql = `
      SELECT 
        period_year,
        period_month,
        SUM(total_net_salary) AS net_salary,
        SUM(total_allowances) AS allowances,
        SUM(total_deductions) AS deductions,
        SUM(total_bonuses) AS bonuses,
        SUM(total_reimbursements) AS reimbursements
      FROM department_financial_summary
      WHERE STR_TO_DATE(CONCAT(period_year, '-', period_month, '-01'), '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      GROUP BY period_year, period_month
      ORDER BY period_year, period_month
    `;

    const [rows] = await pool.query(sql, [months]);
    res.json(rows);
  } catch (err) {
    console.error("Error in compensateTrendLastMonths:", err);
    res.status(500).json({ error: 'Database query failed' });
  }
};


const getDeductionsByType = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const sql = `
      SELECT type, SUM(amount) AS total_amount
      FROM deductions
      WHERE YEAR(effective_date) = ?
      GROUP BY type
    `;

    const [rows] = await pool.query(sql, [year]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching deductions by type:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
};

const getAllowancesByType = async (req, res) => {
  try {
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    const sql = `
      SELECT category as type, SUM(amount) AS total_amount
      FROM allowances
      WHERE MONTH(effective_from) = ? AND YEAR(effective_from) = ?
      GROUP BY category
    `;

    // Pass month first, then year
    const [rows] = await pool.query(sql, [month, year]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching allowances by type:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
};

const getBonusesByType = async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const quarter = parseInt(req.query.quarter, 10); // optional 1,2,3,4

    let sql = `
      SELECT reason as type, SUM(amount) AS total_amount
      FROM bonuses
      WHERE YEAR(effective_date) = ?
    `;

    const params = [year];

    if (quarter >= 1 && quarter <= 4) {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      sql += ` AND MONTH(effective_date) BETWEEN ? AND ?`;
      params.push(startMonth, endMonth);
    }

    sql += ` GROUP BY reason`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching bonuses by type:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
};


// Controller to get employee insights with optional department filter
const getEmployeeInsights = async (req, res) => {
  try {
    const { departmentId } = req.query;

    // Prepare department filter and query parameters
    const deptFilter = departmentId ? 'WHERE department_id = ?' : '';
    const queryParams = departmentId ? [departmentId] : [];

    // Get total employees
    const [[{ total_employees }]] = await pool.query(
      `SELECT COUNT(*) AS total_employees FROM employees ${deptFilter}`,
      queryParams
    );

    // Get total departments
    const [[{ total_departments }]] = await pool.query(
      'SELECT COUNT(*) AS total_departments FROM departments'
    );

    // Get gender-wise employee count
    const [genderCounts] = await pool.query(
      `SELECT gender, COUNT(*) AS total FROM employees ${deptFilter} GROUP BY gender`,
      queryParams
    );

    // Get employment type count
    const [typeCounts] = await pool.query(
      `SELECT employment_type AS type, COUNT(*) AS total FROM employees ${deptFilter} GROUP BY employment_type`,
      queryParams
    );

    // Get employee grade count
    const [gradeCounts] = await pool.query(
      `SELECT grade, COUNT(*) AS total FROM employees ${deptFilter} GROUP BY grade`,
      queryParams
    );

    // Send response
    res.json({
      total_employees,
      total_departments,
      gender: genderCounts,
      types: typeCounts,
      grades: gradeCounts
    });

  } catch (error) {
    console.error('Error fetching employee insights:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
};

// Controller to fetch all departments
const getAllDepartments = async (req, res) => {
  try {
    const [departments] = await pool.query('SELECT * FROM departments');
    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
};




module.exports = {
  getMonthlyTotalData, getSalaryRange, compensateTrend, getAllowancesByType, getBonusesByType, getDeductionsByType, getEmployeeInsights, getAllDepartments
};
