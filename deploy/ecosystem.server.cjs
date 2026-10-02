// PM2 app definition for the Deployment Maintainer agent (not a deployed app —
// those get their own generated ecosystem.config.cjs from services/pm2.js).
// Used on every server you manage.
//
//   pm2 start deploy/ecosystem.server.cjs
//
// `cwd` is resolved relative to this file so it works regardless of where the
// repo is cloned. Keep it a single fork-mode process: the deploy lock is in memory.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'deployment-maintainer',
      script: 'src/index.js',
      cwd: path.join(__dirname, '..', 'server'),
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
    },
  ],
};
