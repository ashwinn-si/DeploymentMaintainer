import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SERVER_JS_SOURCE = `const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(process.env.GREETING || '');
});
server.listen(PORT);
`;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// A bare repo + working "seed" clone, served over file:// so git.js's
// syncRepo can be exercised without any network access or real GitHub token.
export async function createGitFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-git-fixture-'));
  const bareDir = path.join(root, 'fixture', 'repo.git');
  const seedDir = path.join(root, 'seed');

  await fsp.mkdir(path.dirname(bareDir), { recursive: true });
  git(root, ['init', '--bare', '-q', bareDir]);

  await fsp.mkdir(seedDir, { recursive: true });
  git(seedDir, ['init', '-q', '-b', 'main']);
  git(seedDir, ['config', 'user.email', 'test@example.com']);
  git(seedDir, ['config', 'user.name', 'Test']);
  git(seedDir, ['config', 'core.autocrlf', 'false']);

  await fsp.writeFile(path.join(seedDir, 'server.js'), SERVER_JS_SOURCE);
  await fsp.writeFile(
    path.join(seedDir, 'package.json'),
    JSON.stringify({ name: 'fixture-app', private: true, scripts: { start: 'node server.js' } }, null, 2),
  );
  git(seedDir, ['add', '-A']);
  git(seedDir, ['commit', '-q', '-m', 'initial commit']);
  git(seedDir, ['remote', 'add', 'origin', bareDir]);
  git(seedDir, ['push', '-q', 'origin', 'main']);

  git(seedDir, ['checkout', '-q', '-b', 'dev']);
  await fsp.writeFile(path.join(seedDir, 'DEV_MARKER.txt'), 'dev branch\n');
  git(seedDir, ['add', '-A']);
  git(seedDir, ['commit', '-q', '-m', 'dev branch commit']);
  git(seedDir, ['push', '-q', 'origin', 'dev']);
  git(seedDir, ['checkout', '-q', 'main']);

  return {
    root,
    remoteBase: `file://${root}`,
    repoFullName: 'fixture/repo',
    seedDir,
    addCommit(branch, { filename = 'extra.txt', content = 'x', message = 'update' } = {}) {
      git(seedDir, ['checkout', '-q', branch]);
      fs.writeFileSync(path.join(seedDir, filename), content);
      git(seedDir, ['add', '-A']);
      git(seedDir, ['commit', '-q', '-m', message]);
      git(seedDir, ['push', '-q', 'origin', branch]);
      return git(seedDir, ['rev-parse', 'HEAD']);
    },
    shaOf(branch) {
      return git(seedDir, ['rev-parse', branch]);
    },
    async cleanup() {
      await fsp.rm(root, { recursive: true, force: true });
    },
  };
}
