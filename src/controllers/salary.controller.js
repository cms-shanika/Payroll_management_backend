const pool = require('../config/db');
const PDFDocument = require('pdfkit');

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

exports.addAllowance = async (req, res) => {
  const { employee_id, name, amount, frequency } = req.body;
  await pool.query(
    'INSERT INTO allowances (employee_id, name, amount, frequency) VALUES (?,?,?,?)',
    [employee_id, name, amount, frequency || 'Monthly']
  );
  res.json({ ok: true, message: 'Allowance added' });
};

exports.addDeduction = async (req, res) => {
  const { employee_id, name, amount, type, effective_date } = req.body;
  await pool.query(
    'INSERT INTO deductions (employee_id, name, amount, type, effective_date) VALUES (?,?,?,?,?)',
    [employee_id, name, amount, type, effective_date]
  );
  res.json({ ok: true, message: 'Deduction added' });
};

exports.addOvertimeAdjustment = async (req, res) => {
  const { employee_id, category, amount, tax_treatment, effective_date, frequency } = req.body;
  await pool.query(
    'INSERT INTO overtime_adjustments (employee_id, category, amount, tax_treatment, effective_date, frequency) VALUES (?,?,?,?,?,?)',
    [employee_id, category, amount, tax_treatment, effective_date, frequency]
  );
  res.json({ ok: true, message: 'Overtime/Adjustment added' });
};

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
