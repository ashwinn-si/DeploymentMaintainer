import path from 'node:path';
import { run } from './shell.js';

export function withNode(version, cmd, argv = []) {
  return ['fnm', ['exec', `--using=${version}`, '--', cmd, ...argv]];
}

export async function runNode(version, cmd, argv = [], options = {}) {
  const [bin, fullArgv] = withNode(version, cmd, argv);
  return run(bin, fullArgv, options);
}

export async function listInstalled(options = {}) {
  const result = await run('fnm', ['list'], options);
  const versions = new Set();
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/v?(\d+\.\d+\.\d+)/);
    if (match) versions.add(match[1]);
  }
  return [...versions];
}

function versionMatches(installed, requested) {
  return installed.some((v) => v === requested || v.startsWith(`${requested}.`));
}

export async function ensureNodeVersion(version, options = {}) {
  const installed = await listInstalled(options);
  if (versionMatches(installed, version)) return;
  const result = await run('fnm', ['install', version], options);
  if (result.code !== 0) {
    throw new Error(`fnm install ${version} failed: ${result.stderr.slice(-500)}`);
  }
}

export async function nodeBinDir(version, options = {}) {
  const result = await runNode(version, 'node', ['-p', 'process.execPath'], options);
  if (result.code !== 0) {
    throw new Error(`Could not resolve node binary for version ${version}: ${result.stderr.slice(-500)}`);
  }
  return path.dirname(result.stdout.trim());
}
