import path from 'node:path';

// Where an app's install/build/env/pm2/publish run: its repo folder plus the optional root directory.
// The repo itself is always cloned whole into APPS_DIR/<name>. Apps without a rootDir field use the repo root.
export function appWorkDir(config, app) {
  return path.join(config.APPS_DIR, app.name, app.rootDir || '');
}

// Static apps have no port, so only node apps get PORT injected into child-process environments.
export function portEnv(app) {
  return app.port != null ? { PORT: String(app.port) } : {};
}
