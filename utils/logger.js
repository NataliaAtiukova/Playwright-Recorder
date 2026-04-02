function ts() {
  return new Date().toISOString();
}

let seq = 0;
const history = [];
const MAX_HISTORY = 500;

function log(message) {
  const line = `[${ts()}] ${message}`;
  console.log(line);

  seq += 1;
  history.push({
    id: seq,
    ts: ts(),
    message,
    line,
  });

  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function info(message) {
  log(`INFO: ${message}`);
}

function warn(message) {
  log(`WARN: ${message}`);
}

function error(message) {
  log(`ERROR: ${message}`);
}

function getLogs(sinceId = 0) {
  const normalized = Number.isFinite(Number(sinceId)) ? Number(sinceId) : 0;
  return history.filter((item) => item.id > normalized);
}

module.exports = {
  info,
  warn,
  error,
  getLogs,
};
