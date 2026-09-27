// PM2 app definition for the dashboard itself (not a deployed app — those get
// their own generated ecosystem.config.cjs from services/pm2.js).
//
//   pm2 start deploy/ecosystem.dashboard.cjs
//
// `cwd` is resolved relative to this file so it works regardless of where the
// repo is cloned.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'deployment-maintainer',
      script: 'src/index.js',
      cwd: path.join(__dirname, '..', 'server'),
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
    },
  ],
};
