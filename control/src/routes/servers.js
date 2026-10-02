import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Server from '../models/Server.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../lib/httpError.js';
import { encryptJSON, decryptJSON } from '../lib/crypto.js';
import { serializeServer } from '../lib/serializers.js';
import { normalizeServerUrl, verifyServer, probeServer } from '../services/agentClient.js';

const SERVER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const nameSchema = z.string().trim().min(1).max(60);
const secretSchema = z.string().min(32);

const createSchema = z.object({
  name: nameSchema,
  url: z.string().min(1),
  serverId: z.string().regex(SERVER_ID_RE, 'serverId must be 8-64 characters: letters, digits, - or _'),
  secret: secretSchema,
});

const patchSchema = z
  .object({ name: nameSchema.optional(), url: z.string().min(1).optional() })
  .refine((v) => v.name !== undefined || v.url !== undefined, { message: 'Nothing to update' });

const rotateSchema = z.object({ secret: secretSchema });

function isDuplicateKeyError(err) {
  return err?.code === 11000;
}

export function createServersRouter(config, statusCache) {
  const router = Router();
  router.use(requireAuth(config));

  const storedSecret = (server) => decryptJSON(config, server.secretEncrypted).secret;

  async function loadStatus(server) {
    let result;
    try {
      result = await probeServer({
        url: server.url,
        serverId: server.serverId,
        secret: storedSecret(server),
      });
    } catch {
      result = { status: 'unauthorized' };
    }
    const $set = { lastStatus: result.status };
    if (result.status === 'online') {
      Object.assign($set, { version: result.version, hostname: result.hostname, lastSeenAt: new Date() });
      result.lastSeenAt = $set.lastSeenAt;
    }
    await Server.updateOne({ _id: server._id }, { $set }).catch(() => {});
    return result;
  }

  async function findServer(rawId) {
    if (!mongoose.isValidObjectId(rawId)) throw new HttpError(404, 'Server not found');
    const server = await Server.findById(rawId);
    if (!server) throw new HttpError(404, 'Server not found');
    return server;
  }

  async function assertUnique({ url, serverId, exceptId }) {
    const clauses = [];
    if (url) clauses.push({ url });
    if (serverId) clauses.push({ serverId });
    const query = { $or: clauses };
    if (exceptId) query._id = { $ne: exceptId };
    const dup = await Server.findOne(query);
    if (!dup) return;
    if (serverId && dup.serverId === serverId) {
      throw new HttpError(409, 'A server with that ID is already registered');
    }
    throw new HttpError(409, 'A server with that URL is already registered');
  }

  function markOnline(server, { version, hostname }) {
    server.version = version;
    server.hostname = hostname;
    server.lastSeenAt = new Date();
    server.lastStatus = 'online';
    statusCache.set(server._id.toString(), { status: 'online', version, hostname, lastSeenAt: server.lastSeenAt });
  }

  router.get('/', async (req, res) => {
    const servers = await Server.find().sort({ createdAt: 1 });
    const summaries = await Promise.all(
      servers.map(async (server) => {
        const status = await statusCache.get(server._id.toString(), () => loadStatus(server));
        return serializeServer(server, status);
      }),
    );
    res.json({ servers: summaries });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const url = normalizeServerUrl(body.url, config);
    await assertUnique({ url, serverId: body.serverId });

    const info = await verifyServer({ url, serverId: body.serverId, secret: body.secret });

    const server = new Server({
      name: body.name,
      url,
      serverId: body.serverId,
      secretEncrypted: encryptJSON(config, { secret: body.secret }),
    });
    markOnline(server, info);
    try {
      await server.save();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'That server is already registered');
      throw err;
    }
    res.json({ server: serializeServer(server, statusCache.peek(server._id.toString())) });
  });

  router.get('/:id', async (req, res) => {
    const server = await findServer(req.params.id);
    res.json({ server: serializeServer(server, statusCache.peek(server._id.toString())) });
  });

  router.patch('/:id', async (req, res) => {
    const body = patchSchema.parse(req.body);
    const server = await findServer(req.params.id);
    const id = server._id.toString();

    if (body.name !== undefined) server.name = body.name;
    if (body.url !== undefined) {
      const url = normalizeServerUrl(body.url, config);
      if (url !== server.url) {
        await assertUnique({ url, exceptId: server._id });
        const info = await verifyServer({ url, serverId: server.serverId, secret: storedSecret(server) });
        server.url = url;
        markOnline(server, info);
      }
    }
    try {
      await server.save();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'A server with that URL is already registered');
      throw err;
    }
    res.json({ server: serializeServer(server, statusCache.peek(id)) });
  });

  router.post('/:id/secret', async (req, res) => {
    const { secret } = rotateSchema.parse(req.body);
    const server = await findServer(req.params.id);

    const info = await verifyServer({ url: server.url, serverId: server.serverId, secret });
    server.secretEncrypted = encryptJSON(config, { secret });
    markOnline(server, info);
    await server.save();
    res.json({ server: serializeServer(server, statusCache.peek(server._id.toString())) });
  });

  router.delete('/:id', async (req, res) => {
    const server = await findServer(req.params.id);
    await server.deleteOne();
    statusCache.delete(server._id.toString());
    res.json({ ok: true });
  });

  return router;
}
