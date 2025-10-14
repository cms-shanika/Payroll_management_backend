// src/controllers/employee.controller.js
const pool = require('../config/db');

// helper: get or create department by name (string from frontend)
async function getOrCreateDepartmentId(conn, deptName) {
  if (!deptName) return null;
  const name = String(deptName).trim();
  if (!name) return null;

  const [exist] = await conn.query('SELECT id FROM departments WHERE name = ?', [name]);
  if (exist.length) return exist[0].id;

  const [ins] = await conn.query('INSERT INTO departments (name) VALUES (?)', [name]);
  return ins.insertId;
}

exports.createEmployee = async (req, res) => {
  // FRONTEND sends mixed fields (personal + official + kin + bank)
  const {
    // personal
    first_name, last_name, initials, calling_name,
    email, personal_email, country_code, phone,
    gender, dob, marital_status, nationality, religion, nic,
    address_permanent, address_temporary,

    // official
    appointment_date,
    department,            // (string name from UI)
    designation,
    working_office, branch, employment_type,
    basic_salary,
    status = 'Active',
    supervisor, grade, designated_emails, epf_no,

    // kin
    kin_name, kin_relationship, kin_nic, kin_dob,

    // NOTE: joining_date is called "appointment_date" in the new UI
  } = req.body;

  const profilePhotoPath = req.files?.profilePhoto?.[0]?.path?.replace(/\\/g, '/');
  const generalDocs = Array.isArray(req.files?.documents) ? req.files.documents : [];
  const bankDoc = req.files?.bankDocument?.[0]; // optional

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // departments: store by name -> id
    const department_id = await getOrCreateDepartmentId(conn, department);

    // Build full_name for listing (keep old column usable by EmployeeInfo table)
    const full_name = [first_name, last_name].filter(Boolean).join(' ').trim() || calling_name || email;

    // Insert employee
    const [empIns] = await conn.query(
      `INSERT INTO employees
       (employee_code, full_name, email, personal_email, phone, country_code,
        department_id, designation, status, joining_date, appointment_date,
        address, address_permanent, address_temporary, emergency_contact,
        profile_photo_path, created_by_user_id,
        first_name, last_name, initials, calling_name,
        gender, dob, marital_status, nationality, religion, nic,
        working_office, branch, employment_type, supervisor, grade, designated_emails, epf_no)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
               ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        null, // employee_code (optional, could auto-generate later)
        full_name, email || null, personal_email || null,
        phone || null, country_code || null,
        department_id, designation || null, status || 'Active',
        // keep joining_date = appointment_date for compatibility with list filters
        appointment_date || null, appointment_date || null,
        // "address" old column: we mirror permanent
        address_permanent || null,
        address_permanent || null, address_temporary || null,
        null, // emergency_contact (not in new UI — keep null)
        profilePhotoPath || null,
        (req.user && req.user.id) || 1,

        first_name || null, last_name || null, initials || null, calling_name || null,
        gender || null, dob || null, marital_status || null, nationality || null, religion || null, nic || null,
        working_office || null, branch || null, employment_type || null, supervisor || null, grade || null,
        designated_emails || null, epf_no || null,
      ]
    );

    const employeeId = empIns.insertId;

    // Salary (basic_salary)
    if (basic_salary && !Number.isNaN(Number(basic_salary))) {
      await conn.query(
        'INSERT INTO salaries (employee_id, basic_salary) VALUES (?, ?)',
        [employeeId, Number(basic_salary)]
      );
    }

    // Kin (optional)
    if (kin_name || kin_relationship || kin_nic || kin_dob) {
      await conn.query(
        'INSERT INTO employee_kin (employee_id, name, relationship, nic, dob) VALUES (?,?,?,?,?)',
        [employeeId, kin_name || null, kin_relationship || null, kin_nic || null, kin_dob || null]
      );
    }

    // Bank account (optional)
    const {
      account_number, account_name, bank_name, branch_name,
    } = req.body;

    if (account_number || account_name || bank_name || branch_name) {
      await conn.query(
        `INSERT INTO employee_bank_accounts
          (employee_id, account_number, account_name, bank_name, branch_name)
         VALUES (?,?,?,?,?)`,
        [employeeId, account_number || null, account_name || null, bank_name || null, branch_name || null]
      );
    }

    // Docs
    for (const f of generalDocs) {
      await conn.query(
        'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
        [employeeId, f.originalname, f.path.replace(/\\/g, '/'), f.mimetype]
      );
    }
    if (bankDoc) {
      await conn.query(
        'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
        [employeeId, `BANK-${bankDoc.originalname}`, bankDoc.path.replace(/\\/g, '/'), bankDoc.mimetype]
      );
    }

    await conn.commit();
    res.status(201).json({ ok: true, id: employeeId, message: 'Employee created' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ ok: false, message: 'Failed to create employee' });
  } finally {
    conn.release();
  }
};

exports.getEmployees = async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.created_at DESC`
  );
  // Compatible with EmployeeInfo.jsx expectations:
  // - department_name
  // - status, designation, phone, joining_date, employee_code/full_name, etc.
  res.json({ ok: true, data: rows });
};

exports.getEmployeeById = async (req, res) => {
  const id = Number(req.params.id);
  const [[emp]] = await pool.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = ?`,
    [id]
  );
  if (!emp) return res.status(404).json({ ok: false, message: 'Not found' });

  const [docs] = await pool.query(
    'SELECT id, file_name, file_path, file_type, uploaded_at FROM employee_documents WHERE employee_id = ?',
    [id]
  );
  const [[kin]] = await pool.query(
    'SELECT * FROM employee_kin WHERE employee_id = ? LIMIT 1',
    [id]
  );
  const [[bank]] = await pool.query(
    'SELECT * FROM employee_bank_accounts WHERE employee_id = ? LIMIT 1',
    [id]
  );
  const [[sal]] = await pool.query(
    'SELECT basic_salary FROM salaries WHERE employee_id = ? ORDER BY id DESC LIMIT 1',
    [id]
  );

  emp.documents = docs;
  emp.kin = kin || null;
  emp.bank_account = bank || null;
  emp.basic_salary = sal ? sal.basic_salary : null;

  res.json({ ok: true, data: emp });
};

exports.updateEmployee = async (req, res) => {
  const id = Number(req.params.id);

  // same shape as create; only update what is provided
  const body = req.body || {};
  const profilePhotoPath = req.files?.profilePhoto?.[0]?.path?.replace(/\\/g, '/');
  const generalDocs = Array.isArray(req.files?.documents) ? req.files.documents : [];
  const bankDoc = req.files?.bankDocument?.[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // map department name -> id if provided
    let department_id = null;
    if (body.department) {
      department_id = await getOrCreateDepartmentId(conn, body.department);
    }

    // for listing consistency
    let full_name = undefined;
    if (body.first_name || body.last_name) {
      const fn = body.first_name || '';
      const ln = body.last_name || '';
      full_name = [fn, ln].filter(Boolean).join(' ').trim() || undefined;
    }

    const fields = {
      employee_code: body.employee_code ?? null,
      full_name,
      email: body.email,
      personal_email: body.personal_email,
      phone: body.phone,
      country_code: body.country_code,
      department_id,
      designation: body.designation,
      status: body.status,
      joining_date: body.appointment_date,   // keep aligned
      appointment_date: body.appointment_date,
      address: body.address_permanent,
      address_permanent: body.address_permanent,
      address_temporary: body.address_temporary,
      profile_photo_path: profilePhotoPath,

      // personal extras
      first_name: body.first_name,
      last_name: body.last_name,
      initials: body.initials,
      calling_name: body.calling_name,
      gender: body.gender,
      dob: body.dob,
      marital_status: body.marital_status,
      nationality: body.nationality,
      religion: body.religion,
      nic: body.nic,

      // official
      working_office: body.working_office,
      branch: body.branch,
      employment_type: body.employment_type,
      supervisor: body.supervisor,
      grade: body.grade,
      designated_emails: body.designated_emails,
      epf_no: body.epf_no
    };

    // Build dynamic SQL that only sets provided values
    const setParts = [];
    const setVals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue; // skip absent
      setParts.push(`${k} = COALESCE(?, ${k})`);
      setVals.push(v || null);
    }
    setVals.push(id);

    if (setParts.length) {
      const [r] = await conn.query(
        `UPDATE employees SET ${setParts.join(', ')} WHERE id = ?`,
        setVals
      );
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ ok: false, message: 'Not found' });
      }
    }

    // salary
    if (body.basic_salary !== undefined && body.basic_salary !== null && body.basic_salary !== '') {
      await conn.query(
        'INSERT INTO salaries (employee_id, basic_salary) VALUES (?, ?)',
        [id, Number(body.basic_salary)]
      );
    }

    // kin (upsert simple)
    const hasKinPayload = (body.kin_name || body.kin_relationship || body.kin_nic || body.kin_dob);
    if (hasKinPayload) {
      const [[existing]] = await conn.query('SELECT id FROM employee_kin WHERE employee_id = ? LIMIT 1', [id]);
      if (existing) {
        await conn.query(
          'UPDATE employee_kin SET name = ?, relationship = ?, nic = ?, dob = ? WHERE id = ?',
          [body.kin_name || null, body.kin_relationship || null, body.kin_nic || null, body.kin_dob || null, existing.id]
        );
      } else {
        await conn.query(
          'INSERT INTO employee_kin (employee_id, name, relationship, nic, dob) VALUES (?,?,?,?,?)',
          [id, body.kin_name || null, body.kin_relationship || null, body.kin_nic || null, body.kin_dob || null]
        );
      }
    }

    // bank (upsert)
    if (
      body.account_number !== undefined ||
      body.account_name !== undefined ||
      body.bank_name !== undefined ||
      body.branch_name !== undefined
    ) {
      const [[existing]] = await conn.query('SELECT id FROM employee_bank_accounts WHERE employee_id = ? LIMIT 1', [id]);
      if (existing) {
        await conn.query(
          `UPDATE employee_bank_accounts
             SET account_number = COALESCE(?, account_number),
                 account_name   = COALESCE(?, account_name),
                 bank_name      = COALESCE(?, bank_name),
                 branch_name    = COALESCE(?, branch_name)
           WHERE id = ?`,
          [body.account_number || null, body.account_name || null, body.bank_name || null, body.branch_name || null, existing.id]
        );
      } else {
        await conn.query(
          `INSERT INTO employee_bank_accounts
            (employee_id, account_number, account_name, bank_name, branch_name)
           VALUES (?,?,?,?,?)`,
          [id, body.account_number || null, body.account_name || null, body.bank_name || null, body.branch_name || null]
        );
      }
    }

    // docs
    for (const f of generalDocs) {
      await conn.query(
        'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
        [id, f.originalname, f.path.replace(/\\/g, '/'), f.mimetype]
      );
    }
    if (bankDoc) {
      await conn.query(
        'INSERT INTO employee_documents (employee_id, file_name, file_path, file_type) VALUES (?,?,?,?)',
        [id, `BANK-${bankDoc.originalname}`, bankDoc.path.replace(/\\/g, '/'), bankDoc.mimetype]
      );
    }

    await conn.commit();
    res.json({ ok: true, message: 'Updated' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ ok: false, message: 'Failed to update employee' });
  } finally {
    conn.release();
  }
};

exports.deleteEmployee = async (req, res) => {
  const id = Number(req.params.id);
  const [r] = await pool.query('DELETE FROM employees WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ ok: false, message: 'Not found' });
  res.json({ ok: true, message: 'Deleted' });
};
