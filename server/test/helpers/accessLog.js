// Builds nginx `combined` access-log lines for tests.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

// Builds an nginx `combined` line for a UTC instant.
export function logLine(iso, { status = 200, bytes = 100, method = 'GET', url = '/x', ua = 'curl/8.0', ip = '203.0.113.9' } = {}) {
  const d = new Date(iso);
  const stamp = `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
  return `${ip} - - [${stamp}] "${method} ${url} HTTP/1.1" ${status} ${bytes} "-" "${ua}"`;
}
