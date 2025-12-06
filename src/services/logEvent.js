const { validate } = require('uuid');
const pool = require('../config/db');
const { event: eventLogger } = require('../logger/logger');
const { logToWinston, extractActor } = require('../utils/sanitize');

async function logEvent({ level = 'info', event_type, user_id = null, req = null, extra = {} }) {

  const actor = extractActor(req, user_id);

  // Whitelist fields for security (avoid sensitive data leaking)
  const sanitize = obj => {
    if (!obj) return null;
    const copy = { ...obj };
    delete copy.password;
    delete copy.token;
    return copy;
  };

  const payload = {
    actor,
    action: event_type,
    ip: req?.ip || null,
    extra,
    timestamp: new Date().toISOString(),
  };


  logToWinston(eventLogger, level, payload);

  // Insert into DB
  // try {
  //   const sql = `
  //     INSERT INTO event_logs
  //     (event_type, user_id, severity, event_details, created_at)
  //     VALUES (?, ?, ?, ?, NOW())
  //   `;
  //   const params = [
  //     event_type,
  //     actor.id,
  //     level.toUpperCase(),
  //     JSON.stringify(payload)
  //   ];

  //   await pool.query(sql, params);
  // } catch (err) {
  //   console.error('Failed to insert event log into DB', err);
  // }
}

module.exports = logEvent;
