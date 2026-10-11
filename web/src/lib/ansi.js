// Terminal color/cursor escapes (e.g. pm2's table output) are meaningless in the
// log viewer and render as stray "[32m" fragments, so drop them.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_RE, '') : text;
}

// Lines drawn with box characters (pm2 tables) must not wrap or the grid shatters.
const BOX_RE = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/;

export function isTableLine(text) {
  return BOX_RE.test(text);
}
