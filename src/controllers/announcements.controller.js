const pool = require('../config/db');
const logAudit = require('../services/logAudit');
const logEvent = require('../services/logEvent');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM announcements ORDER BY created_date DESC");
    res.json(rows);
  } catch (err) {
    logEvent({ level:'error', event_type: "DB_QUERY_ERROR", user_id: req.user?.id, req, extra: { error_message: err.message } });
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { title, announcement_text, start_date, end_date, description, created_by } = req.body;

    if (!title || !announcement_text || !start_date || !created_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const sql = `
      INSERT INTO announcements (title, announcement_text, start_date, end_date, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [title, announcement_text, start_date, end_date, description, created_by];

    const [result] = await pool.query(sql, params);
    logAudit({ level:'info', user_id: req.user?.id, action_type: 'CREATE_ANNOUNCEMENT', target_table: 'announcements', target_id: result.insertId, before_state: null, after_state: { title, announcement_text, start_date, end_date, description, created_by }, status:'SUCCESS', req} );
    res.json({ message: "Announcement created", id: result.insertId });
  } catch (err) {
    console.error(err);
    logAudit({level:'error', user_id: req.user?.id, action_type: 'CREATE_ANNOUNCEMENT', target_table: 'announcements', target_id: null, before_state: null, after_state: req.body, status:'FAILURE', req,error_message: err.message  } );
    res.status(500).json({ message: "Insert failed" });
  }
};

exports.update = async (req, res) => {
  try {
    const { announcement_id } = req.params;
    const { title, announcement_text, start_date, end_date, description } = req.body;

    if (!announcement_id) {
      return res.status(400).json({ message: "ID required" });
    }

    const sql = `
      UPDATE announcements SET
        title = ?, announcement_text = ?, start_date = ?, end_date = ?, description = ?
      WHERE announcement_id = ?
    `;
    const params = [title, announcement_text, start_date, end_date, description, announcement_id];

    await pool.query(sql, params);
    res.json({ message: "Announcement updated" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
};

exports.remove = async (req, res) => {
  try {
    const { announcement_id } = req.params;

    if (!announcement_id) {
      return res.status(400).json({ message: "ID required" });
    }

    await pool.query("DELETE FROM announcements WHERE announcement_id = ?", [announcement_id]);
    res.json({ message: "Announcement deleted" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
};