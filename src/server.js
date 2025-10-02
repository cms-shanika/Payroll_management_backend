const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await pool.query('SELECT 1'); // check DB
    app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error('Cannot connect to MySQL', e);
    process.exit(1);
  }
}

start();
