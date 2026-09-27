import fs from 'node:fs/promises';
import path from 'node:path';
import { validateEnvFilename } from '../lib/validate.js';

export const type = 'writeEnv';

export function label(config) {
  return `Write ${config?.filename || '.env'}`;
}

// Single-quote by default (dotenv treats single-quoted values literally); values
// containing a single quote fall back to a double-quoted, backslash-escaped form.
function formatEnvValue(value) {
  const str = String(value);
  if (!str.includes("'")) {
    return `'${str}'`;
  }
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export async function run(ctx) {
  const { app, env, config, log, state, step, stepId } = ctx;
  const filename = validateEnvFilename(step?.config?.filename || '.env');
  const dir = state.appDir ?? path.join(config.APPS_DIR, app.name);
  const allVars = { ...env, PORT: String(app.port) };
  const contents = `${Object.entries(allVars).map(([k, v]) => `${k}=${formatEnvValue(v)}`).join('\n')}\n`;

  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, contents, { mode: 0o600 });
  // writeFile's mode only applies when the file is created; chmod covers overwriting an existing one.
  await fs.chmod(filePath, 0o600);
  log.info(`wrote ${filename} (${Object.keys(allVars).length} vars)`, stepId);
}
