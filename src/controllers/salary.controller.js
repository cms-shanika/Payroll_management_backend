const { ExpressValidator } = require('express-validator');
const pool = require('../config/db');
const PDFDocument = require('pdfkit');

// ===================new content ======================

// ============lists for grids =======================

exports.listAllowances = async (req, res) => {
  const { employee_id } = req.query; // optional
  const [rows] = employee_id
    ? await pool.query('SELECT * FROM allowances WHERE employee_id=? ORDER BY created_at DESC', [employee_id])
    : await pool.query(`
        SELECT a.*, e.full_name
        FROM allowances a
        JOIN employees e ON e.id=a.employee_id
        ORDER BY a.created_at DESC
      `);
  res.json({ ok: true, data: rows });
};

exports.listDeductions = async (req, res) => {
  const { employee_id } = req.query;
  const [rows] = employee_id
    ? await pool.query('SELECT * FROM deductions WHERE employee_id=? ORDER BY created_at DESC', [employee_id])
    : await pool.query(`
        SELECT d.*, e.full_name
        FROM deductions d
        JOIN employees e ON e.id=d.employee_id
        ORDER BY d.created_at DESC
      `);
  res.json({ ok: true, data: rows });
};

exports.listOvertime = async (req, res) => {
  const { employee_id } = req.query;
  const [rows] = employee_id
    ? await pool.query('SELECT * FROM overtime_adjustments WHERE employee_id=? ORDER BY created_at DESC', [employee_id])
    : await pool.query(`
        SELECT o.*, e.full_name
        FROM overtime_adjustments o
        JOIN employees e ON e.id=o.employee_id
        ORDER BY o.created_at DESC
      `);
  res.json({ ok: true, data: rows });
};

/** ===== CREATEs for forms ===== **/

exports.addBonus = async (req, res) => {
  const { employee_id, amount, reason, effective_date } = req.body;
  if (!employee_id || !amount || !effective_date)
    return res.status(400).json({ ok: false, message: 'employee_id, amount, effective_date required' });

  await pool.query(
    'INSERT INTO bonuses (employee_id, amount, reason, effective_date, created_by) VALUES (?,?,?,?,?)',
    [employee_id, amount, reason || null, effective_date, req.user?.id || null]
  );
  res.json({ ok: true, message: 'Bonus added' });
};

/** ===== EARNINGS GRID ===== **/
exports.listEarnings = async (req, res) => {
  const { month, year } = req.query; // optional; if omitted, show current month captures
  const [emps] = await pool.query(`
    SELECT e.id, e.full_name, d.name AS department, s.basic_salary
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN salaries s ON s.employee_id = e.id
    WHERE e.status='Active'
  `);

  // per employee aggregates (month/year aware if provided)
  const params = [];
  let dateFilter = '';
  if (month && year) {
    dateFilter = ' AND MONTH(effective_date)=? AND YEAR(effective_date)=? ';
    params.push(Number(month), Number(year));
  }

  const [allowMapRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM allowances
    WHERE status='Active' ${dateFilter}
    GROUP BY employee_id
  `, params);

  const [otMapRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM overtime_adjustments
    WHERE status='Approved' ${dateFilter}
    GROUP BY employee_id
  `, params);

  const [bonusMapRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM bonuses
    WHERE 1=1 ${dateFilter}
    GROUP BY employee_id
  `, params);

  // make lookup
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
};

/** ===== MONTH SUMMARY / RUN ===== **/

exports.monthSummary = async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ ok:false, message:'month, year required' });

  // earnings
  const [earnings] = await pool.query(`
    SELECT e.id AS employee_id, s.basic_salary
    FROM employees e
    LEFT JOIN salaries s ON s.employee_id = e.id
    WHERE e.status='Active'
  `);

  const params = [Number(month), Number(year)];

  const [allowRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM allowances
    WHERE status='Active' AND (effective_from IS NULL OR (MONTH(effective_from)<=? AND YEAR(effective_from)<=?))
    GROUP BY employee_id
  `, params);

  const [otRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM overtime_adjustments
    WHERE status='Approved' AND MONTH(effective_date)=? AND YEAR(effective_date)=?
    GROUP BY employee_id
  `, params);

  const [bonusRows] = await pool.query(`
    SELECT employee_id, SUM(amount) AS total
    FROM bonuses
    WHERE MONTH(effective_date)=? AND YEAR(effective_date)=?
    GROUP BY employee_id
  `, params);

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
  `, params);

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
};

exports.runPayrollForMonth = async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ ok:false, message:'month, year required' });

  // Use monthSummary() logic
  req.query = { month, year };
  const fakeRes = { json: (p)=>p };
  const { data } = await exports.monthSummary(req, fakeRes);

  // persist into payroll_cycles (one row per employee)
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
    throw e;
  } finally {
    conn.release();
  }

  res.json({ ok:true, message: `Payroll run stored for ${month}/${year}`, count: data.length });
};





// -----------set basic salary 

exports.setBasicSalary = async (req, res) => {
  const { employee_id, basic_salary } = req.body;
  if (!employee_id || !basic_salary) {
    return res.status(400).json({ ok: false, message: 'employee_id and basic_salary required' });
  }

  await pool.query(
    'INSERT INTO salaries (employee_id, basic_salary) VALUES (?, ?) ON DUPLICATE KEY UPDATE basic_salary=VALUES(basic_salary)',
    [employee_id, basic_salary]
  );

  res.json({ ok: true, message: 'Basic salary set' });
};


// ------------------- add allowances 

exports.addAllowance = async (req, res) => {
  const { employee_id, name, amount, frequency } = req.body;
  await pool.query(
    'INSERT INTO allowances (employee_id, name, amount, frequency) VALUES (?,?,?,?)',
    [employee_id, name, amount, frequency || 'Monthly']
  );
  res.json({ ok: true, message: 'Allowance added' });
};



// ----------------- add deductions 

exports.addDeduction = async (req, res) => {
  const { employee_id, name, amount, type, effective_date } = req.body;
  await pool.query(
    'INSERT INTO deductions (employee_id, name, amount, type, effective_date) VALUES (?,?,?,?,?)',
    [employee_id, name, amount, type, effective_date]
  );
  res.json({ ok: true, message: 'Deduction added' });
};


// ------------------ overtime adjustment 

exports.addOvertimeAdjustment = async (req, res) => {
  const { employee_id, category, amount, tax_treatment, effective_date, frequency } = req.body;
  await pool.query(
    'INSERT INTO overtime_adjustments (employee_id, category, amount, tax_treatment, effective_date, frequency) VALUES (?,?,?,?,?,?)',
    [employee_id, category, amount, tax_treatment, effective_date, frequency]
  );
  res.json({ ok: true, message: 'Overtime/Adjustment added' });
};


// ------------- genrate payslip 

exports.generatePayslip = async (req, res) => {

    
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

  const gross = (salary?.basic_salary || 0) +
                allowances.reduce((a, b) => a + b.amount, 0) +
                adjustments.reduce((a, b) => a + b.amount, 0);

  const totalDeductions = deductions.reduce((a, b) => a + b.amount, 0);
  const net = gross - totalDeductions;

  // Save payroll cycle summary
  await pool.query(
    'INSERT INTO payroll_cycles (employee_id, period_month, period_year, gross_earnings, total_deductions, net_salary) VALUES (?,?,?,?,?,?)',
    [employee_id, month, year, gross, totalDeductions, net]
  );

  // Generate PDF payslip
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
};
