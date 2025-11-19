const getClientIP = require('./getClientIP');

function extractActor(req, user_id) {
  return {
    id: req?.user?.id ?? user_id ?? null,
    ip: req ? getClientIP(req) : null,
    user_agent: req?.headers["user-agent"] ?? null
  };
}

function logToWinston(logger, level, payload) {
  if (logger && typeof logger[level] === "function") {
    logger[level](payload);
  } else {
    console.error("Invalid logger level:", level, payload);
  }
}


module.exports = { extractActor, logToWinston };