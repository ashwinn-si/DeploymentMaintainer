import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// fnm shim: `list` reads/`install` appends to a JSON-free, line-per-version
// state file; `exec --using=<v> -- <cmd...>` just execs the real binary
// (node/npm are never shimmed, so this resolves through the real PATH).
const FNM_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (process.env.SHIM_CALLS_LOG) {
  fs.appendFileSync(process.env.SHIM_CALLS_LOG, 'fnm ' + args.join(' ') + '\\n');
}

function readInstalled() {
  const f = process.env.FNM_INSTALLED_FILE;
  if (!f || !fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\\n').filter(Boolean);
}

const [sub, ...rest] = args;

if (sub === 'list') {
  for (const v of readInstalled()) process.stdout.write('* v' + v + '\\n');
  process.exit(0);
}

if (sub === 'install') {
  // Real fnm always records a fully-qualified semver; synthesize one from a
  // bare major so listInstalled()'s \\d+\\.\\d+\\.\\d+ parser can find it.
  let version = rest[0];
  if (!/\\./.test(version)) version = version + '.0.0';
  const f = process.env.FNM_INSTALLED_FILE;
  if (f) fs.appendFileSync(f, version + '\\n');
  process.stdout.write('Installed Node ' + version + '\\n');
  process.exit(0);
}

if (sub === 'exec') {
  const dashIdx = rest.indexOf('--');
  const cmdArgs = rest.slice(dashIdx + 1);
  const [cmd, ...cmdRest] = cmdArgs;
  const result = spawnSync(cmd, cmdRest, { stdio: 'inherit', env: process.env });
  process.exit(result.status ?? 0);
}

process.exit(0);
`;

// pm2 shim: state lives in a small JSON object keyed by process name
// ($PM2_STATE_FILE). startOrReload actually requires the ecosystem file and
// spawns the real script in the background so a genuine HTTP health check
// can hit it; stop/delete kill the recorded pid so tests leave no orphans.
const PM2_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
if (process.env.SHIM_CALLS_LOG) {
  fs.appendFileSync(process.env.SHIM_CALLS_LOG, 'pm2 ' + args.join(' ') + '\\n');
}

function readState() {
  const f = process.env.PM2_STATE_FILE;
  if (!f || !fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  const f = process.env.PM2_STATE_FILE;
  if (f) fs.writeFileSync(f, JSON.stringify(state));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(pid)) {
    const spinUntil = Date.now() + 20;
    while (Date.now() < spinUntil) { /* brief synchronous spin; test infra only */ }
  }
}

const [sub, ...rest] = args;

// Kills the recorded pid (if alive) and waits for it to exit.
function killPrevious(previous) {
  if (previous && previous.pid && isAlive(previous.pid)) {
    try {
      process.kill(previous.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    waitForDeath(previous.pid, 2000);
  }
}

// Spawns the first app in the ecosystem file and records it (with ecoPath, so restart can re-read it).
function spawnFromEcosystem(ecoPath, previous) {
  delete require.cache[require.resolve(ecoPath)];
  const cfg = require(ecoPath);
  const appCfg = cfg.apps[0];

  // Real pm2 stops the old process before starting the new one; without this a
  // crashing new version can be masked by the still-running previous process.
  killPrevious(previous || readState()[appCfg.name]);

  const child = spawn(appCfg.script, appCfg.args || [], {
    cwd: appCfg.cwd,
    env: { ...process.env, ...appCfg.env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const state = readState();
  const prevRestartTime = (previous || state[appCfg.name])?.pm2_env?.restart_time ?? -1;
  state[appCfg.name] = {
    name: appCfg.name,
    pid: child.pid,
    ecoPath,
    pm2_env: { status: 'online', restart_time: prevRestartTime + 1 },
  };
  writeState(state);
  return { name: appCfg.name, pid: child.pid };
}

if (sub === 'startOrReload' || sub === 'start') {
  const started = spawnFromEcosystem(rest[0]);
  process.stdout.write('started ' + started.name + ' pid ' + started.pid + '\\n');
  process.exit(0);
}

if (sub === 'jlist') {
  process.stdout.write(JSON.stringify(Object.values(readState())) + '\\n');
  process.exit(0);
}

if (sub === 'stop' || sub === 'delete') {
  const name = rest[0];
  const state = readState();
  const proc = state[name];
  if (proc && proc.pid) {
    try {
      process.kill(proc.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  if (sub === 'delete') {
    delete state[name];
  } else if (proc) {
    proc.pm2_env.status = 'stopped';
  }
  writeState(state);
  process.exit(0);
}

if (sub === 'restart') {
  // Restart accepts a process name or an ecosystem file path (the deploy step uses the latter).
  let name = rest[0];
  if (name.endsWith('.cjs')) name = require(name).apps[0].name;
  const proc = readState()[name];
  if (proc && proc.ecoPath) {
    // Real "restart --update-env" re-reads the caller's env, not the ecosystem file; the shim
    // re-reads the stored ecosystem file so a redeploy's changed env/command is picked up.
    const started = spawnFromEcosystem(proc.ecoPath, proc);
    process.stdout.write('restarted ' + started.name + ' pid ' + started.pid + '\\n');
  }
  process.exit(0);
}

if (sub === 'save' || sub === 'logs') {
  process.exit(0);
}

process.exit(0);
`;

// sudo shim: strips -n, logs the call, and fails on demand via SUDO_FAIL_ON
// (a substring match against the invoked command) so nginx -t failures and
// their rollback path can be exercised without touching real sudo/nginx.
const SUDO_SHIM = `#!/usr/bin/env node
const fs = require('fs');

const args = process.argv.slice(2).filter((a) => a !== '-n');
if (process.env.SHIM_CALLS_LOG) {
  fs.appendFileSync(process.env.SHIM_CALLS_LOG, 'sudo ' + args.join(' ') + '\\n');
}

const failOn = process.env.SUDO_FAIL_ON;
if (failOn && args.join(' ').includes(failOn)) {
  process.stderr.write('shim: simulated failure for "' + failOn + '"\\n');
  process.exit(1);
}
process.exit(0);
`;

async function writeShim(binDir, name, source) {
  const filePath = path.join(binDir, name);
  await fsp.writeFile(filePath, source, { mode: 0o755 });
  return filePath;
}

export async function createShims() {
  const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-shim-bin-'));
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-shim-state-'));
  const callsLog = path.join(stateDir, 'calls.log');
  const fnmInstalledFile = path.join(stateDir, 'fnm-installed.txt');
  const pm2StateFile = path.join(stateDir, 'pm2-state.json');

  await fsp.writeFile(callsLog, '');
  await fsp.writeFile(fnmInstalledFile, '');
  await fsp.writeFile(pm2StateFile, '{}');

  await Promise.all([
    writeShim(binDir, 'fnm', FNM_SHIM),
    writeShim(binDir, 'pm2', PM2_SHIM),
    writeShim(binDir, 'sudo', SUDO_SHIM),
  ]);

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    SHIM_CALLS_LOG: callsLog,
    FNM_INSTALLED_FILE: fnmInstalledFile,
    PM2_STATE_FILE: pm2StateFile,
  };

  function readCalls() {
    return fs.readFileSync(callsLog, 'utf8').split('\n').filter(Boolean);
  }

  function readPm2State() {
    return JSON.parse(fs.readFileSync(pm2StateFile, 'utf8'));
  }

  async function killAllPm2Pids() {
    const state = readPm2State();
    for (const proc of Object.values(state)) {
      if (proc.pid) {
        try {
          process.kill(proc.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }

  async function cleanup() {
    await killAllPm2Pids();
    await fsp.rm(binDir, { recursive: true, force: true });
    await fsp.rm(stateDir, { recursive: true, force: true });
  }

  return { binDir, env, callsLog, fnmInstalledFile, pm2StateFile, readCalls, readPm2State, cleanup };
}

// Services read PATH off process.env at spawn time (see shell.js), so tests
// patch it in place for the duration of a call rather than threading a
// custom `env` through every service function. Returns a restore function.
export function patchProcessEnv(shims) {
  const keys = ['PATH', 'SHIM_CALLS_LOG', 'FNM_INSTALLED_FILE', 'PM2_STATE_FILE', 'SUDO_FAIL_ON'];
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  process.env.PATH = `${shims.binDir}${path.delimiter}${original.PATH ?? ''}`;
  process.env.SHIM_CALLS_LOG = shims.callsLog;
  process.env.FNM_INSTALLED_FILE = shims.fnmInstalledFile;
  process.env.PM2_STATE_FILE = shims.pm2StateFile;

  return function restore() {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
}
