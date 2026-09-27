import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncRepo, getHeadSha, safeRemoveAppDir } from '../src/services/git.js';
import { createGitFixture } from './helpers/gitFixture.js';

async function withFixture(fn) {
  const fixture = await createGitFixture();
  const appsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-apps-'));
  const config = { GIT_REMOTE_BASE: fixture.remoteBase, GITHUB_TOKEN: undefined, APPS_DIR: appsRoot };
  try {
    await fn({ fixture, appsRoot, config });
  } finally {
    await fixture.cleanup();
    await fsp.rm(appsRoot, { recursive: true, force: true });
  }
}

test('syncRepo clones a missing directory on main', async () => {
  await withFixture(async ({ fixture, appsRoot, config }) => {
    const dir = path.join(appsRoot, 'app1');
    const sha = await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    assert.equal(sha, fixture.shaOf('main'));
    assert.ok(fs.existsSync(path.join(dir, 'server.js')));
    assert.ok(fs.existsSync(path.join(dir, '.git')));
  });
});

test('syncRepo updates in place after a new commit on the same branch', async () => {
  await withFixture(async ({ fixture, appsRoot, config }) => {
    const dir = path.join(appsRoot, 'app2');
    await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    const firstSha = await getHeadSha(dir);

    const newSha = fixture.addCommit('main', { filename: 'CHANGED.txt', content: 'v2', message: 'v2' });
    assert.notEqual(newSha, firstSha);

    const resultSha = await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    assert.equal(resultSha, newSha);
    assert.ok(fs.existsSync(path.join(dir, 'CHANGED.txt')));
  });
});

test('syncRepo switches branches on an existing checkout', async () => {
  await withFixture(async ({ fixture, appsRoot, config }) => {
    const dir = path.join(appsRoot, 'app3');
    await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    assert.ok(!fs.existsSync(path.join(dir, 'DEV_MARKER.txt')));

    const sha = await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'dev', config });
    assert.equal(sha, fixture.shaOf('dev'));
    assert.ok(fs.existsSync(path.join(dir, 'DEV_MARKER.txt')));
  });
});

test('syncRepo resets to an explicit sha (rollback)', async () => {
  await withFixture(async ({ fixture, appsRoot, config }) => {
    const dir = path.join(appsRoot, 'app4');
    const originalSha = await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    fixture.addCommit('main', { filename: 'later.txt', content: 'later', message: 'later commit' });

    const sha = await syncRepo({
      dir,
      repoFullName: fixture.repoFullName,
      branch: 'main',
      sha: originalSha,
      config,
    });
    assert.equal(sha, originalSha);
    assert.ok(!fs.existsSync(path.join(dir, 'later.txt')));
  });
});

test('syncRepo with fresh=true deletes and re-clones', async () => {
  await withFixture(async ({ fixture, appsRoot, config }) => {
    const dir = path.join(appsRoot, 'app5');
    await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    await fsp.writeFile(path.join(dir, 'untracked-local-junk.txt'), 'junk');

    const sha = await syncRepo({
      dir,
      repoFullName: fixture.repoFullName,
      branch: 'main',
      fresh: true,
      config,
    });
    assert.equal(sha, fixture.shaOf('main'));
    assert.ok(!fs.existsSync(path.join(dir, 'untracked-local-junk.txt')));
  });
});

test('safeRemoveAppDir refuses to remove a path outside APPS_DIR', async () => {
  const config = { APPS_DIR: '/tmp/definitely-not-real-apps-dir' };
  await assert.rejects(() => safeRemoveAppDir(config, '../../etc'));
  await assert.rejects(() => safeRemoveAppDir(config, '.'));
});

test('the token never appears in .git/config', async () => {
  await withFixture(async ({ fixture, appsRoot }) => {
    const config = { GIT_REMOTE_BASE: fixture.remoteBase, GITHUB_TOKEN: 'ghp_fake_token_value', APPS_DIR: appsRoot };
    const dir = path.join(appsRoot, 'app6');
    await syncRepo({ dir, repoFullName: fixture.repoFullName, branch: 'main', config });
    const gitConfig = await fsp.readFile(path.join(dir, '.git', 'config'), 'utf8');
    assert.ok(!gitConfig.includes('ghp_fake_token_value'));
    assert.ok(!gitConfig.includes('extraheader'));
  });
});

test('a failing clone over an https-style remote never leaks the token or its base64 into the error message', async () => {
  const token = 'ghp_fake_token_value_for_error_message_test';
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  const appsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-apps-'));
  const config = {
    // Port 1 is reserved and nothing listens there, so this fails fast without touching the network.
    GIT_REMOTE_BASE: 'https://127.0.0.1:1',
    GITHUB_TOKEN: token,
    APPS_DIR: appsRoot,
  };
  try {
    const dir = path.join(appsRoot, 'app7');
    await assert.rejects(
      () => syncRepo({ dir, repoFullName: 'fixture/repo', branch: 'main', config }),
      (err) => {
        assert.ok(!err.message.includes(token));
        assert.ok(!err.message.includes(basic));
        return true;
      },
    );
  } finally {
    await fsp.rm(appsRoot, { recursive: true, force: true });
  }
});
