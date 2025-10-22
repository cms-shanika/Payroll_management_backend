// src/controllers/salary.controller.js
const pool = require('../config/db');
const PDFDocument = require('pdfkit');

/* ===================== LISTS (for grids) ===================== */

async function listAllowances(req, res) {
  try {
    const { employee_id } = req.query; // optional
    const [rows] = employee_id
      ? await pool.query(
          `
          SELECT 
            id, employee_id, 
            name AS description,         -- alias for FE
            category, amount, taxable, frequency,
            effective_from, effective_to,
            status, created_at, updated_at
          FROM allowances
          WHERE employee_id=?
          ORDER BY created_at DESC
          `,
          [employee_id]
        )
      : await pool.query(`
          SELECT 
            a.id, a.employee_id, 
            a.name AS description,       -- alias for FE
            a.category, a.amount, a.taxable, a.frequency,
            a.effective_from, a.effective_to,
            a.status, a.created_at, a.updated_at,
            e.full_name
          FROM allowances a
          JOIN employees e ON e.id = a.employee_id
          ORDER BY a.created_at DESC
        `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to load allowances' });
  }
}

async function listOvertime(req, res) {
  try {
    const { employee_id } = req.query;
    const [rows] = employee_id
      ? await pool.query(
          'SELECT * FROM overtime_adjustments WHERE employee_id=? ORDER BY created_at DESC',
          [employee_id]
        )
      : await pool.query(`
          SELECT o.*, e.full_name
          FROM overtime_adjustments o
          JOIN employees e ON e.id=o.employee_id
          ORDER BY o.created_at DESC
        `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to load overtime/adjustments' });
  }
}

/* ===================== DEDUCTIONS ===================== */

async function listDeductions(req, res) {
  try {
    const { month, year } = req.query;
    let where = '1=1';
    const params = [];

    if (month && year) {
      where += ' AND MONTH(d.effective_date)=? AND YEAR(d.effective_date)=?';
      params.push(Number(month), Number(year));
    }

    const [rows] = await pool.query(
      `SELECT d.id, d.employee_id, e.full_name AS employee_name,
              d.name, d.type, d.basis, d.percent, d.amount,
              d.status, d.effective_date, d.created_at, d.updated_at
         FROM deductions d
         JOIN employees e ON e.id = d.employee_id
        WHERE ${where}
        ORDER BY d.effective_date DESC, d.id DESC`,
      params
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to load deductions' });
  }
}

async function createDeduction(req, res) {
  try {
    const {
      employee_id,
      name,
      type,            // 'Tax' | 'Statutory' | 'Insurance' | 'Loan' | 'Other'
      basis,           // 'Fixed' | 'Percent'
      percent,         // if basis = Percent
      amount,          // if basis = Fixed
      effective_date,
      status = 'Active',
    } = req.body;

    if (!employee_id || !name || !type || !basis || !effective_date) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    if (basis === 'Percent' && (percent == null || isNaN(percent))) {
      return res.status(400).json({ ok: false, message: 'Percent is required for Percent basis' });
    }
    if (basis === 'Fixed' && (amount == null || isNaN(amount))) {
      return res.status(400).json({ ok: false, message: 'Amount is required for Fixed basis' });
    }

    const [result] = await pool.query(
      `INSERT INTO deductions
        (employee_id, name, type, basis, percent, amount, effective_date, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [employee_id, name, type, basis, percent ?? null, amount ?? null, effective_date, status]
    );

    res.json({ ok: true, id: result.insertId, message: 'Deduction saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to save deduction' });
  }
}

/* ========== BASIC SALARY (also used by percent preview) ========== */

async function getBasicSalary(req, res) {
  const { employee_id } = req.query;
  if (!employee_id) return res.status(400).json({ ok: false, message: 'employee_id required' });
  const [[row]] = await pool.query('SELECT basic_salary FROM salaries WHERE employee_id=?', [employee_id]);
  res.json({ basic_salary: row?.basic_salary || 0 });
}

async function setBasicSalary(req, res) {
  const { employee_id, basic_salary } = req.body;
  if (!employee_id || basic_salary == null) {
    return res.status(400).json({ ok: false, message: 'employee_id and basic_salary required' });
  }
  await pool.query(
    `INSERT INTO salaries (employee_id, basic_salary)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE basic_salary=VALUES(basic_salary), updated_at=NOW()`,
    [employee_id, basic_salary]
  );
  res.json({ ok: true, message: 'Basic salary set' });
}

/* ===================== CREATES (forms) ===================== */

/**
 * Add Allowance
 * Accepts: employee_id, description, category, amount, taxable, frequency, effective_from, effective_to, status
 * DB: stores description -> name (no migration needed)
 */
async function addAllowance(req, res) {
  try {
    const {
      employee_id,
      description,                 // NEW (mapped to DB column `name`)
      category = null,
      amount,
      taxable = 0,
      frequency = 'Monthly',
      effective_from = null,
      effective_to = null,
      status = 'Active',
    } = req.body;

    if (!employee_id || !description || amount == null) {
      return res.status(400).json({ ok: false, message: 'employee_id, description, amount are required' });
    }

    await pool.query(
      `INSERT INTO allowances
        (employee_id, name, category, amount, taxable, frequency, effective_from, effective_to, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?, NOW())`,
      [employee_id, description, category, amount, Number(taxable) ? 1 : 0, frequency, effective_from, effective_to, status]
    );

    res.json({ ok: true, message: 'Allowance added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Failed to add allowance' });
  }
}

async function addOvertimeAdjustment(req, res) {
  const { employee_id, category, amount, tax_treatment, effective_date, frequency, status = 'Approved' } = req.body;
  await pool.query(
    'INSERT INTO overtime_adjustments (employee_id, category, amount, tax_treatment, effective_date, frequency, status, created_at) VALUES (?,?,?,?,?,?,?, NOW())',
    [employee_id, category, amount, tax_treatment, effective_date, frequency, status]
  );
  res.json({ ok: true, message: 'Overtime/Adjustment added' });
}

async function addBonus(req, res) {
  const { employee_id, amount, reason, effective_date } = req.body;
  if (!employee_id || !amount || !effective_date)
    return res.status(400).json({ ok: false, message: 'employee_id, amount, effective_date required' });

  await pool.query(
    'INSERT INTO bonuses (employee_id, amount, reason, effective_date, created_by) VALUES (?,?,?,?,?)',
    [employee_id, amount, reason || null, effective_date, req.user?.id || null]
  );
  res.json({ ok: true, message: 'Bonus added' });
}

/* ===================== EARNINGS GRID ===================== */

async function listEarnings(req, res) {
  const { month, year } = req.query; // optional
  const [emps] = await pool.query(`
    SELECT e.id, e.full_name, d.name AS department, s.basic_salary
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN salaries s ON s.employee_id = e.id
    WHERE e.status='Active'
  `);

  // Build allowance/overtime/bonus maps with optional period filter
  const params = [];
  let allowWhere = "WHERE status='Active'";
  let otWhere = "WHERE status='Approved'";
  let bonusWhere = "WHERE 1=1";

  if (month && year) {
    // Use effective_from/effective_to for allowances period inclusion
    const first = new Date(Number(year), Number(month) - 1, 1);
    const last = new Date(Number(year), Number(month), 0); // end of month
    const firstStr = first.toISOString().slice(0, 10);
    const lastStr = last.toISOString().slice(0, 10);

    allowWhere += ' AND (effective_from IS NULL OR effective_from <= ?)';
    allowWhere += ' AND (effective_to IS NULL OR effective_to >= ?)';
    params.push(lastStr, firstStr);

    otWhere += ' AND MONTH(effective_date)=? AND YEAR(effective_date)=?';
    bonusWhere += ' AND MONTH(effective_date)=? AND YEAR(effective_date)=?';
    params.push(Number(month), Number(year), Number(month), Number(year));
  }

  const [allowMapRows] = await pool.query(
    `SELECT employee_id, SUM(amount) AS total FROM allowances ${allowWhere} GROUP BY employee_id`,
    params.slice(0, allowWhere.includes('?') ? 2 : 0) // only first two params belong to allowances
  );

  const restParams = month && year ? [Number(month), Number(year)] : [];
  const [otMapRows] = await pool.query(
    `SELECT employee_id, SUM(amount) AS total FROM overtime_adjustments ${otWhere} GROUP BY employee_id`,
    restParams
  );
  const [bonusMapRows] = await pool.query(
    `SELECT employee_id, SUM(amount) AS total FROM bonuses ${bonusWhere} GROUP BY employee_id`,
    restParams
  );

  const toMap = (rows) => rows.reduce((m, r) => (m[r.employee_id] = Number(r.total || 0), m), {});
  const A = toMap(allowMapRows);
  const O = toMap(otMapRows);
  const B = toMap(bonusMapRows);

  const data = emps.map(e => {
    const basic = Number(e.basic_salary || 0);
    const overtime = O[e.id] || 0;
    const bonus = B[e.id] || 0;
    const allowances = A[e.id] || 0;
    const gross = basic + overtime + bonus + allowances;
    return {
      employee_id: e.id,
      name: e.full_name,
      department: e.department || '',
      basic_salary: basic,
      overtime, bonus, allowances,
      gross
    };
  });

  res.json({ ok: true, data });
}

/* ===================== MONTH SUMMARY & RUN ===================== */

async function monthSummary(req, res) {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ ok:false, message:'month, year required' });

  const [earnings] = await pool.query(`
    SELECT e.id AS employee_id, s.basic_salary
    FROM employees e
    LEFT JOIN salaries s ON s.employee_id = e.id
    WHERE e.status='Active'
  `);

  // Period bounds
  const first = new Date(Number(year), Number(month) - 1, 1);
  const last = new Date(Number(year), Number(month), 0);
  const firstStr = first.toISOString().slice(0,10);
  const lastStr = last.toISOString().slice(0,10);

  // Allowances active within the month
  const [allowRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM allowances
    WHERE status='Active'
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    GROUP BY employee_id
  `, [lastStr, firstStr]);

  // Overtime/Bonuses strictly in the month
  const [otRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM overtime_adjustments
    WHERE status='Approved' AND MONTH(effective_date)=? AND YEAR(effective_date)=?
    GROUP BY employee_id
  `, [Number(month), Number(year)]);

  const [bonusRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM bonuses
    WHERE MONTH(effective_date)=? AND YEAR(effective_date)=?
    GROUP BY employee_id
  `, [Number(month), Number(year)]);

  const [dedRows] = await pool.query(`
    SELECT employee_id, SUM(
      CASE WHEN basis='Percent' AND percent IS NOT NULL
           THEN (percent/100.0) * COALESCE((SELECT basic_salary FROM salaries WHERE employee_id=deductions.employee_id LIMIT 1), 0)
           ELSE amount
      END
    ) AS total
    FROM deductions
    WHERE status='Active' AND MONTH(effective_date)<=? AND YEAR(effective_date)<=?
    GROUP BY employee_id
  `, [Number(month), Number(year)]);

  const map = r => r.reduce((m, x) => (m[x.employee_id] = Number(x.total||0), m), {});
  const A = map(allowRows), O = map(otRows), B = map(bonusRows), D = map(dedRows);

  const data = earnings.map(e => {
    const basic = Number(e.basic_salary||0);
    const gross = basic + (A[e.employee_id]||0) + (O[e.employee_id]||0) + (B[e.employee_id]||0);
    const totalDeductions = D[e.employee_id] || 0;
    const net = gross - totalDeductions;
    return { employee_id: e.employee_id, basic, allowances:A[e.employee_id]||0, overtime:O[e.employee_id]||0, bonus:B[e.employee_id]||0, gross, totalDeductions, net };
  });

  res.json({ ok:true, data });
}

async function runPayrollForMonth(req, res) {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ ok:false, message:'month, year required' });

  // reuse summary
  const fakeReq = { query: { month, year } };
  const fakeRes = { json: (p) => p };
  const { data } = await monthSummary(fakeReq, fakeRes);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of data) {
      await conn.query(`
        INSERT INTO payroll_cycles (employee_id, period_month, period_year, gross_earnings, total_deductions, net_salary, generated_at)
        VALUES (?,?,?,?,?,?, NOW())
      `, [r.employee_id, month, year, r.gross, r.totalDeductions, r.net]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ ok:false, message:'Failed to run payroll' });
  } finally {
    conn.release();
  }

  res.json({ ok:true, message: `Payroll run stored for ${month}/${year}`, count: data.length });
}

/* ===================== PAYSLIP ===================== */

async function generatePayslip(req, res) {
  const { employee_id, month, year } = req.query;
  if (!employee_id || !month || !year) {
    return res.status(400).json({ ok: false, message: 'employee_id, month, year required' });
  }

  const [[emp]] = await pool.query('SELECT full_name, email FROM employees WHERE id=?', [employee_id]);
  if (!emp) return res.status(404).json({ ok: false, message: 'Employee not found' });

  const [[salary]] = await pool.query('SELECT basic_salary FROM salaries WHERE employee_id=?', [employee_id]);
  const [allowances] = await pool.query('SELECT * FROM allowances WHERE employee_id=?', [employee_id]);
  const [deductions] = await pool.query('SELECT * FROM deductions WHERE employee_id=?', [employee_id]);
  const [adjustments] = await pool.query('SELECT * FROM overtime_adjustments WHERE employee_id=?', [employee_id]);

  const gross = (salary?.basic_salary || 0)
    + allowances.reduce((a, b) => a + Number(b.amount || 0), 0)
    + adjustments.reduce((a, b) => a + Number(b.amount || 0), 0);

  const totalDeductions = deductions.reduce((a, b) => a + Number(b.amount || 0), 0);
  const net = gross - totalDeductions;

  await pool.query(
    'INSERT INTO payroll_cycles (employee_id, period_month, period_year, gross_earnings, total_deductions, net_salary, generated_at) VALUES (?,?,?,?,?,?, NOW())',
    [employee_id, month, year, gross, totalDeductions, net]
  );

  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="payslip_${emp.full_name}_${month}_${year}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text('Payslip', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Employee: ${emp.full_name}`);
  doc.text(`Email: ${emp.email}`);
  doc.text(`Period: ${month}/${year}`);
  doc.moveDown();
  doc.text(`Basic Salary: $${salary?.basic_salary || 0}`);
  allowances.forEach(a => doc.text(`Allowance - ${a.name}: $${a.amount}`));
  adjustments.forEach(a => doc.text(`Overtime/Adj - ${a.category}: $${a.amount}`));
  deductions.forEach(d => doc.text(`Deduction - ${d.name}: -$${d.amount}`));
  doc.moveDown();
  doc.text(`Gross: $${gross}`);
  doc.text(`Total Deductions: $${totalDeductions}`);
  doc.text(`Net Salary: $${net}`, { underline: true });
  doc.end();
}

/* ===================== EXPORTS ===================== */

module.exports = {
  // lists
  listAllowances,
  listDeductions,
  listOvertime,

  // creates
  createDeduction,
  addAllowance,
  addOvertimeAdjustment,
  addBonus,

  // salary helpers
  setBasicSalary,
  getBasicSalary,

  // earnings/summary/run
  listEarnings,
  monthSummary,
  runPayrollForMonth,

  // payslip
  generatePayslip,
};
