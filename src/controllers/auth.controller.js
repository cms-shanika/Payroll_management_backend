const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ ok:false, message: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ ok:false, message: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({
    ok: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
};

exports.me = async (req, res) => {
  res.json({ ok:true, user: req.user });
};
