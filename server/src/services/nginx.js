import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.js';
import { validateNginxPath } from '../lib/validate.js';

function proxyBlock(location, proxyPass) {
  return `location ${location} {
    proxy_pass ${proxyPass};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
`;
}

export function renderLocation({ path: routePath, port, stripPrefix = true }) {
  validateNginxPath(routePath);

  if (!stripPrefix) {
    return proxyBlock(routePath, `http://127.0.0.1:${port}`);
  }

  // Without this, a request to the bare path (no trailing slash) 404s instead of matching the "<path>/" block below.
  const redirect = `location = ${routePath} {
    return 301 ${routePath}/;
}
`;
  return redirect + proxyBlock(`${routePath}/`, `http://127.0.0.1:${port}/`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// -n so a missing/expired sudo cache fails fast instead of hanging on a password prompt.
async function runSudo(args, { onLine, signal } = {}) {
  const result = await run('sudo', ['-n', ...args], { onLine, signal });
  if (result.code !== 0) {
    throw new Error(`sudo ${args.join(' ')} failed: ${result.stderr.slice(-500)}`);
  }
  return result;
}

function routeFilePath(config, appName) {
  return path.join(config.NGINX_APPS_DIR, `${appName}.conf`);
}

export async function applyAppRoute(app, { config, stepConfig = {}, onLine, signal } = {}) {
  if (!config.NGINX_ENABLED) {
    onLine?.({ stream: 'info', text: 'skipped (NGINX_ENABLED=false)' });
    return { applied: false };
  }

  const routePath = stepConfig.path || `/${app.name}`;
  const stripPrefix = stepConfig.stripPrefix ?? true;
  const content = renderLocation({ path: routePath, port: app.port, stripPrefix });
  const filePath = routeFilePath(config, app.name);

  let previous = null;
  try {
    previous = await fs.readFile(filePath, 'utf8');
  } catch {
    previous = null;
  }

  if (previous === content) {
    return { applied: false };
  }

  await fs.writeFile(filePath, content, { mode: 0o644 });

  try {
    await runSudo(['nginx', '-t'], { onLine, signal });
    await runSudo(['systemctl', 'reload', 'nginx'], { onLine, signal });
  } catch (err) {
    if (previous !== null) {
      await fs.writeFile(filePath, previous, { mode: 0o644 });
    } else {
      await fs.rm(filePath, { force: true });
    }
    throw err;
  }

  return { applied: true };
}

export async function removeAppRoute(app, { config, onLine, signal } = {}) {
  if (!config.NGINX_ENABLED) {
    onLine?.({ stream: 'info', text: 'skipped (NGINX_ENABLED=false)' });
    return { removed: false };
  }

  const filePath = routeFilePath(config, app.name);
  if (!(await fileExists(filePath))) {
    return { removed: false };
  }

  const previous = await fs.readFile(filePath, 'utf8');
  await fs.rm(filePath, { force: true });

  try {
    await runSudo(['nginx', '-t'], { onLine, signal });
    await runSudo(['systemctl', 'reload', 'nginx'], { onLine, signal });
  } catch (err) {
    await fs.writeFile(filePath, previous, { mode: 0o644 });
    throw err;
  }

  return { removed: true };
}
