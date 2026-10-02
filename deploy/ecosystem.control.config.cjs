// PM2 app definition for the control plane (the dashboard). Only on the server
// that hosts it.
//
//   pm2 start deploy/ecosystem.control.config.cjs
//
// `cwd` is resolved relative to this file so it works regardless of where the
// repo is cloned. Keep it a single fork-mode process.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'deployment-control',
      script: 'src/start.js',
      cwd: path.join(__dirname, '..', 'control'),
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
    },
  ],
};
