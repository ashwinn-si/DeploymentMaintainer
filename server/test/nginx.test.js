import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderLocation, applyAppRoute, removeAppRoute } from '../src/services/nginx.js';
import { HttpError } from '../src/lib/httpError.js';
import { createShims, patchProcessEnv } from './helpers/shims.js';

async function withShims(fn) {
  const shims = await createShims();
  const restore = patchProcessEnv(shims);
  try {
    await fn(shims);
  } finally {
    restore();
    await shims.cleanup();
  }
}

async function withNginxDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-nginx-apps-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('renderLocation includes websocket upgrade, X-Forwarded headers and a read timeout', () => {
  const block = renderLocation({ path: '/my-app', port: 4001, stripPrefix: true });
  assert.match(block, /location \/my-app\/ \{/);
  assert.match(block, /proxy_pass http:\/\/127\.0\.0\.1:4001\/;/);
  assert.match(block, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(block, /proxy_set_header Connection "upgrade";/);
  assert.match(block, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  assert.match(block, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(block, /proxy_read_timeout 60s;/);
});

test('renderLocation adds a 301 redirect from the bare path to the trailing-slash path when stripPrefix is true', () => {
  const block = renderLocation({ path: '/my-app', port: 4001, stripPrefix: true });
  assert.match(block, /location = \/my-app \{\n\s*return 301 \/my-app\/;\n\}/);
});

test('renderLocation without stripPrefix forwards the raw path and has no redirect block', () => {
  const block = renderLocation({ path: '/my-app', port: 4001, stripPrefix: false });
  assert.match(block, /location \/my-app \{/);
  assert.match(block, /proxy_pass http:\/\/127\.0\.0\.1:4001;/);
  assert.ok(!block.includes('return 301'));
});

test('renderLocation rejects a path that would inject extra nginx directives', () => {
  for (const badPath of ['/x;\nlocation / { proxy_pass http://evil', '/a b', '/../x', 'no-leading-slash']) {
    assert.throws(() => renderLocation({ path: badPath, port: 4001 }), HttpError);
  }
});

test('applyAppRoute is a no-op that logs "skipped" when NGINX_ENABLED is false', async () => {
  await withNginxDir(async (nginxDir) => {
    const config = { NGINX_ENABLED: false, NGINX_APPS_DIR: nginxDir };
    const lines = [];
    const result = await applyAppRoute({ name: 'my-app', port: 4001 }, {
      config,
      onLine: (l) => lines.push(l),
    });
    assert.deepEqual(result, { applied: false });
    assert.ok(lines.some((l) => l.text.includes('skipped')));
    await assert.rejects(fs.access(path.join(nginxDir, 'my-app.conf')));
  });
});

test('applyAppRoute writes the file, runs nginx -t and reloads via sudo', async () => {
  await withShims(async (shims) => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      const result = await applyAppRoute({ name: 'my-app', port: 4001 }, { config });
      assert.deepEqual(result, { applied: true });

      const content = await fs.readFile(path.join(nginxDir, 'my-app.conf'), 'utf8');
      assert.match(content, /proxy_pass http:\/\/127\.0\.0\.1:4001\/;/);

      const calls = shims.readCalls();
      assert.ok(calls.includes('sudo nginx -t'));
      assert.ok(calls.includes('sudo systemctl reload nginx'));
    });
  });
});

test('applyAppRoute skips writing when the rendered content is unchanged', async () => {
  await withShims(async (shims) => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      const app = { name: 'my-app', port: 4001 };
      await applyAppRoute(app, { config });
      const callsAfterFirst = shims.readCalls().length;

      const result = await applyAppRoute(app, { config });
      assert.deepEqual(result, { applied: false });
      assert.equal(shims.readCalls().length, callsAfterFirst, 'no new sudo calls on a no-op apply');
    });
  });
});

test('applyAppRoute restores the previous file when nginx -t fails', async () => {
  await withShims(async (shims) => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      const app = { name: 'my-app', port: 4001 };
      await applyAppRoute(app, { config });
      const original = await fs.readFile(path.join(nginxDir, 'my-app.conf'), 'utf8');

      process.env.SUDO_FAIL_ON = 'nginx -t';
      const changedApp = { name: 'my-app', port: 4002 };
      await assert.rejects(() => applyAppRoute(changedApp, { config }));
      delete process.env.SUDO_FAIL_ON;

      const restored = await fs.readFile(path.join(nginxDir, 'my-app.conf'), 'utf8');
      assert.equal(restored, original);
    });
  });
});

test('applyAppRoute removes the file it just wrote when nginx -t fails and there was no previous file', async () => {
  await withShims(async () => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      process.env.SUDO_FAIL_ON = 'nginx -t';
      await assert.rejects(() => applyAppRoute({ name: 'brand-new', port: 4003 }, { config }));
      delete process.env.SUDO_FAIL_ON;
      await assert.rejects(fs.access(path.join(nginxDir, 'brand-new.conf')));
    });
  });
});

test('removeAppRoute deletes an existing route file and reloads', async () => {
  await withShims(async (shims) => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      const app = { name: 'my-app', port: 4001 };
      await applyAppRoute(app, { config });

      const result = await removeAppRoute(app, { config });
      assert.deepEqual(result, { removed: true });
      await assert.rejects(fs.access(path.join(nginxDir, 'my-app.conf')));

      const calls = shims.readCalls();
      assert.ok(calls.includes('sudo systemctl reload nginx'));
    });
  });
});

test('removeAppRoute is a no-op when no route file exists', async () => {
  await withShims(async () => {
    await withNginxDir(async (nginxDir) => {
      const config = { NGINX_ENABLED: true, NGINX_APPS_DIR: nginxDir };
      const result = await removeAppRoute({ name: 'never-deployed', port: 4001 }, { config });
      assert.deepEqual(result, { removed: false });
    });
  });
});
