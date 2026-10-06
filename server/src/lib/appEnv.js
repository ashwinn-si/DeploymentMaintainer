// Static apps have no port, so only node apps get PORT injected into child-process environments.
export function portEnv(app) {
  return app.port != null ? { PORT: String(app.port) } : {};
}
