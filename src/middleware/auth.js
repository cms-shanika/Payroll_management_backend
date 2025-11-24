const jwt = require('jsonwebtoken');
const logEvent = require('../services/logEvent');

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) {
    logEvent({ level: 'error', event_type: "AUTH_FAILURE",
      user_id: req.user || null,
      event_details: { reason: "Missing token" },
    })
    return res.status(401).json({ ok: false, message: 'Missing token' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET );
    req.user = payload; // { id, role, name, email }

    next();
  } catch (e) {
    logEvent({ level: 'error', event_type: "AUTH_FAILURE",
      user_id: req.user || null,
      event_details: { reason: "Invalid/expired token", error: e.message }, })
    return res.status(401).json({ ok: false, message: 'Invalid/expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
       logEvent({ level: 'error', event_type: "AUTH_FAILURE", user_id: req.user,  extra: { reason: "Required Role is missing" },
    })
      return res.status(403).json({ ok: false, message: 'Forbidden' });
      
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
