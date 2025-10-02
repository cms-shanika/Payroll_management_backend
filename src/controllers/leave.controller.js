const pool = require('../config/db');
const dayjs = require('dayjs');

function computeDurationHours(startDate, endDate, startTime, endTime) {
  // Full-day default (8 hours per day) unless times are provided
  const s = dayjs(`${startDate}${startTime ? ' ' + startTime : ' 09:00'}`);
  const e = dayjs(`${endDate}${endTime ? ' ' + endTime : ' 18:00'}`);

  // Prevent negatives
  const h = Math.max(0, e.diff(s, 'minute')) / 60;
  return Number(h.toFixed(2));
}

exports.createRequest = async (req, res) => {
  const {
    employee_id, leave_type_id, start_date, end_date,
    start_time, end_time, reason
  } = req.body;

  const [empRows] = await pool.query(
    'SELECT id, department_id FROM employees WHERE id = ?',
    [employee_id]
  );
  const emp = empRows[0];
  if (!emp) return res.status(404).json({ ok:false, message: 'Employee not found' });

  const duration_hours = computeDurationHours(start_date, end_date, start_time, end_time);
  const attachment_path = req.file ? req.file.path.replace(/\\/g,'/') : null;

  const [result] = await pool.query(
    `INSERT INTO leave_requests
     (employee_id, leave_type_id, start_date, end_date, start_time, end_time,
      duration_hours, department_id, reason, attachment_path, status, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?)`,
    [
      employee_id, leave_type_id, start_date, end_date, start_time || null, end_time || null,
      duration_hours, emp.department_id || null, reason || null, attachment_path, req.user.id
    ]
  );

  res.status(201).json({ ok:true, id: result.insertId, duration_hours });
};

exports.listRequests = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
  const offset = (page - 1) * pageSize;

  const { status, search, department_id, from, to } = req.query;

  const filters = [];
  const params = [];

  if (status) { filters.push('lr.status = ?'); params.push(status); }
  if (department_id) { filters.push('lr.department_id = ?'); params.push(Number(department_id)); }
  if (from) { filters.push('lr.start_date >= ?'); params.push(from); }
  if (to) { filters.push('lr.end_date <= ?'); params.push(to); }
  if (search) {
    filters.push('(e.full_name LIKE ? OR e.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT lr.*, e.full_name, e.employee_code, d.name AS department_name, lt.name AS leave_type
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     LEFT JOIN departments d ON d.id = lr.department_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     ${where}
     ORDER BY lr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ count }]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     ${where}`,
    params
  );

  res.json({ ok:true, page, pageSize, total: count, data: rows });
};

exports.decideRequest = async (req, res) => {
  const id = Number(req.params.id);
  const { action, note } = req.body;

  const [[lr]] = await pool.query('SELECT * FROM leave_requests WHERE id=?', [id]);
  if (!lr) return res.status(404).json({ ok:false, message: 'Request not found' });
  if (lr.status !== 'PENDING' && action !== 'RESPOND') {
    return res.status(400).json({ ok:false, message: 'Already decided' });
  }

  let newStatus = lr.status;
  if (action === 'APPROVE') newStatus = 'APPROVED';
  if (action === 'REJECT') newStatus = 'REJECTED';

  await pool.query(
    `UPDATE leave_requests SET
       status = ?,
       decided_by_user_id = ?,
       decided_at = NOW(),
       decision_note = COALESCE(?, decision_note)
     WHERE id = ?`,
    [newStatus, req.user.id, note || null, id]
  );

  // Optional: update leave_balances on approve
  if (action === 'APPROVE') {
    const year = dayjs(lr.start_date).year();
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled_days, used_days)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE used_days = used_days + VALUES(used_days)`,
      [lr.employee_id, lr.leave_type_id, year, 0, lr.duration_hours / 8]  // convert hours to days if you prefer
    );
  }

  res.json({ ok:true, message: action === 'RESPOND' ? 'Response saved' : `Request ${newStatus.toLowerCase()}` });
};

exports.statusList = async (req, res) => {
  // Same list as Request, but return extra counters for the top widgets
  const { from, to } = req.query;

  // list
  await exports.listRequests(req, res);  // re-use the above handler by calling it
  
};

exports.calendarFeed = async (req, res) => {
  const { from, to } = req.query;

  const [rows] = await pool.query(
    `SELECT lr.id, e.full_name, lt.name AS leave_type,
            lr.start_date, lr.end_date, lr.status, lr.duration_hours
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.status = 'APPROVED'
       AND lr.end_date >= ? AND lr.start_date <= ?
     ORDER BY lr.start_date ASC`,
    [from, to]
  );

  // Simple calendar event format
  const events = rows.map(r => ({
    id: r.id,
    title: `${r.full_name} - ${r.leave_type}`,
    start: r.start_date,
    end: r.end_date,
    status: r.status,
    hours: r.duration_hours
  }));

  res.json({ ok:true, events });
};

exports.summary = async (req, res) => {
  const year = parseInt(req.query.year || String(dayjs().year()), 10);

  // usage by type
  const [byType] = await pool.query(
    `SELECT lt.name AS leave_type, SUM(lr.duration_hours) AS hours
     FROM leave_requests lr
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE YEAR(lr.start_date) = ? AND lr.status='APPROVED'
     GROUP BY lt.name
     ORDER BY lt.name ASC`,
    [year]
  );

  // employees currently on leave today
  const today = dayjs().format('YYYY-MM-DD');
  const [[{ onLeaveToday }]] = await pool.query(
    `SELECT COUNT(*) AS onLeaveToday
     FROM leave_requests
     WHERE status='APPROVED' AND start_date <= ? AND end_date >= ?`,
    [today, today]
  );

  res.json({
    ok: true,
    year,
    onLeaveToday,
    byType
  });
};
