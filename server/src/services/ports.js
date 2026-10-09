import net from 'node:net';
import App from '../models/App.js';
import { HttpError } from '../lib/httpError.js';

const MAX_PORT = 65535;

export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

// `exclude` lets callers (e.g. the staged-deploy smoke test) reserve ports that aren't in the DB yet.
export async function allocatePort(config, { exclude = [] } = {}) {
  const used = new Set((await App.find({}, 'port').lean()).map((a) => a.port));
  for (const port of exclude) used.add(port);
  for (let port = config.APP_PORT_START; port <= MAX_PORT; port += 1) {
    if (!used.has(port) && (await isPortFree(port))) {
      return port;
    }
  }
  throw new HttpError(500, 'No free ports available');
}

export async function assertPortAvailable(port, excludeAppId) {
  const query = excludeAppId ? { port, _id: { $ne: excludeAppId } } : { port };
  const conflict = await App.findOne(query).lean();
  if (conflict) {
    throw new HttpError(400, `Port ${port} is already used by app "${conflict.name}"`);
  }
  if (!(await isPortFree(port))) {
    throw new HttpError(400, `Port ${port} is already in use on this machine`);
  }
}
