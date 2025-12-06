const pool = require('../config/db');
const logAudit = require('../services/logAudit');
const logEvent = require('../services/logEvent');

exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY name ASC');
    res.json({ ok: true, data: rows })
  }
  catch (err) {
    console.error(err);
    logEvent({ level: 'error', event_type: "DB_QUERY_ERROR", req, extra: { error_message: err.message } });
    res.status(500).json({ ok: false, error: 'Failed to fetch departments' });
  };
};

exports.create = async (req, res) => {
  try {
    const { name
      // , manager_name, description, status 
    } = req.body;
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Department name is required' });
    }

    // const [result] = await pool.query(
    //   'INSERT INTO departments (name, manager_name, description, status, created_at) VALUES (?, ?, ?, ?, NOW())',
    //   [name, manager_name || '', description || '', status || 'Active']
    // );

    const [result] = await pool.query(
      'INSERT INTO departments (name) VALUE (?)', [name]
    );

    const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [result.insertId]);
    logAudit({ level: 'info', user_id: req.user?.id, action_type: 'CREATE_DEPARTMENT', target_table: 'departments', target_id: result.insertId, before_state: null, after_state: { rows }, status: 'SUCCESS', req });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    logAudit({ level: 'error', user_id: req.user?.id, action_type: 'CREATE_DEPARTMENT', target_table: 'departments', target_id: null, before_state: null, after_state: req.body, status: 'FAILURE', req, error_message: err.message });
    res.status(500).json({ ok: false, error: 'Failed to create department' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name,
      //  manager_name, description, status
    } = req.body;

    // const [result] = await pool.query(
    //   'UPDATE departments SET name = ?, manager_name = ?, description = ?, status = ? WHERE id = ?',
    //   [name, manager_name, description, status, id]
    // );
    const [rowsBefore] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);

    const [result] = await pool.query(
      'UPDATE departments SET name = ? WHERE id = ? ', [name, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: 'Department not found' });
    }

    const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);
    logAudit({ level: 'info', user_id: req.user?.id, action_type: 'UPDATE_DEPARTMENT', target_table: 'departments', target_id: id, before_state: rowsBefore, after_state: { rows }, status: 'SUCCESS', req });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    logAudit({ level: 'error', user_id: req.user?.id, action_type: 'UPDATE_DEPARTMENT', target_table: 'departments', target_id: req.params.id, before_state: null, after_state: req.body, status: 'FAILURE', req, error_message: err.message });
    res.status(500).json({ ok: false, error: 'Failed to update department' });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM departments WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: 'Department not found' });
    }
    logAudit({ level: 'info', user_id: req.user?.id, action_type: 'DELETE_DEPARTMENT', target_table: 'departments', target_id: id, before_state: null, after_state: null, status: 'SUCCESS', req });
    res.json({ ok: true, message: 'Department deleted successfully' });
  } catch (err) {
    console.error(err);
    logAudit({ level: 'error', user_id: req.user?.id, action_type: 'DELETE_DEPARTMENT', target_table: 'departments', target_id: req.params.id, before_state: null, after_state: null, status: 'FAILURE', req, error_message: err.message });
    res.status(500).json({ ok: false, error: 'Failed to delete department' });
  }
};
