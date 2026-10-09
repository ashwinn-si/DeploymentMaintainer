import fs from 'node:fs/promises';
import path from 'node:path';
import { run, tokenizeCommand } from './shell.js';
import { appWorkDir } from '../lib/appEnv.js';

const ECOSYSTEM_FILENAME = 'ecosystem.config.cjs';

export function pm2Name(appName) {
  return `app-${appName}`;
}

// The ecosystem file lives in the app's work dir (repo folder + root directory).
export function ecosystemPath(workDir) {
  return path.join(workDir, ECOSYSTEM_FILENAME);
}

// `dir` is the work dir the process runs in (default: the live work dir under appsDir); name/port/filename
// override the live-app defaults so a staged build can be run as a throwaway process.
export async function writeEcosystem(app, { env = {}, binDir, appsDir, startCommand, dir, name, port, filename }) {
  const [script, ...args] = tokenizeCommand(startCommand || 'npm start');
  const appDir = dir ?? appWorkDir({ APPS_DIR: appsDir }, app);
  const pathPrefix = binDir ? `${binDir}${path.delimiter}` : '';

  const ecosystem = {
    apps: [
      {
        name: name ?? pm2Name(app.name),
        script,
        args,
        interpreter: 'none',
        cwd: appDir,
        env: { ...env, PORT: String(port ?? app.port), PATH: `${pathPrefix}${process.env.PATH ?? ''}` },
        autorestart: true,
      },
    ],
  };

  const filePath = filename ? path.join(appDir, filename) : ecosystemPath(appDir);
  await fs.writeFile(filePath, `module.exports = ${JSON.stringify(ecosystem, null, 2)};\n`, { mode: 0o600 });
  return filePath;
}

// Parses an ecosystem file written by writeEcosystem and returns its first app, or null if missing/unparseable.
export async function readEcosystem(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const json = text.trim().replace(/^module\.exports\s*=\s*/, '').replace(/;$/, '');
    return JSON.parse(json).apps?.[0] ?? null;
  } catch {
    return null;
  }
}

// Compares two ecosystem app definitions; returns a short reason when they differ (null if equivalent).
export function describeDefinitionChange(prev, next) {
  if (!prev || !next) return 'previous definition unavailable';
  if (prev.script !== next.script || JSON.stringify(prev.args ?? []) !== JSON.stringify(next.args ?? [])) {
    return 'start command changed';
  }
  if (prev.cwd !== next.cwd) return 'working directory changed';
  if (prev.env?.PATH !== next.env?.PATH) return 'node version changed';
  return null;
}

async function pm2(args, options = {}) {
  const result = await run('pm2', args, options);
  if (result.code !== 0) {
    throw new Error(`pm2 ${args.join(' ')} exited with code ${result.code}: ${result.stderr.slice(-500)}`);
  }
  return result;
}

export function startOrReload(ecoPath, options) {
  return pm2(['startOrReload', ecoPath, '--update-env'], options);
}

export function start(ecoPath, options) {
  return pm2(['start', ecoPath, '--update-env'], options);
}

export function stop(name, options) {
  return pm2(['stop', name], options);
}

export function restart(name, options) {
  return pm2(['restart', name], options);
}

// Restarting by ecosystem file re-reads its env block (a plain `restart <name> --update-env` would
// inject the dashboard's own environment into the app instead).
export function restartFromEcosystem(ecoPath, options) {
  return pm2(['restart', ecoPath, '--update-env'], options);
}

export function remove(name, options) {
  return pm2(['delete', name], options);
}

// Delete that treats an unknown process as success (teardown paths must not fail on it).
export async function deleteQuiet(name, options) {
  try {
    await remove(name, options);
  } catch (err) {
    if (!/not (found|exist)|doesn't exist/i.test(err.message)) throw err;
  }
}

export function save(options) {
  return pm2(['save'], options);
}

export async function jlist(options) {
  const result = await pm2(['jlist'], options);
  let list;
  try {
    list = JSON.parse(result.stdout);
  } catch {
    list = [];
  }
  const byName = {};
  for (const proc of list) byName[proc.name] = proc;
  return byName;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOG_HEADER_RE = /^(\S.*\.log) last \d+ lines:\s*$/;
// pm2 prefixes every line with "<id>|<name> | ".
const LINE_PREFIX_RE = /^\d+\|[^|]*\| ?/;

// `pm2 logs --nostream` prints one "<file>.log last N lines:" section per log file.
// Splits those into stdout and stderr (the *-error.log file) and cleans the lines up.
// Output without recognisable sections is returned as all stdout.
export function splitLogs(raw) {
  const out = [];
  const err = [];
  let target = null;
  for (const rawLine of String(raw ?? '').replace(ANSI_RE, '').split(/\r?\n/)) {
    const header = rawLine.match(LOG_HEADER_RE);
    if (header) {
      target = /(^|[-_./])(error|err)\.log$/i.test(header[1]) ? err : out;
      continue;
    }
    if (target === null) {
      if (/^\[TAILING\]/.test(rawLine)) continue;
      if (!rawLine.trim()) continue;
      out.push(rawLine.replace(LINE_PREFIX_RE, ''));
      continue;
    }
    if (rawLine.trim()) target.push(rawLine.replace(LINE_PREFIX_RE, ''));
  }
  return { out: out.join('\n'), err: err.join('\n') };
}

export async function logs(name, lines = 200, options) {
  const result = await pm2(['logs', name, '--lines', String(lines), '--nostream'], options);
  return result.stdout;
}
