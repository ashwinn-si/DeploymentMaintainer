import http from 'node:http';
import https from 'node:https';
import mongoose from 'mongoose';
import Server from '../models/Server.js';
import { HttpError } from '../lib/httpError.js';
import { decryptJSON } from '../lib/crypto.js';

const FORWARD_REQUEST_HEADERS = ['content-type', 'content-length', 'accept', 'last-event-id'];
const COPY_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'x-accel-buffering'];
const IDLE_TIMEOUT_MS = 60_000;
const ROTATE_MESSAGE = 'The server rejected the stored secret — rotate it in Servers';

// req.params.rest arrives decoded, so re-encode each segment; "." and ".." would escape /api/.
function buildUpstreamPath(req) {
  const segments = [].concat(req.params.rest ?? []);
  if (segments.some((s) => s === '.' || s === '..')) {
    throw new HttpError(400, 'Invalid path');
  }
  const search = new URL(req.originalUrl, 'http://localhost').search;
  return `/api/${segments.map(encodeURIComponent).join('/')}${search}`;
}

export function createProxyHandler(config, statusCache) {
  return async function proxyHandler(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Server not found');
    const server = await Server.findById(req.params.id);
    if (!server) throw new HttpError(404, 'Server not found');

    const secret = decryptJSON(config, server.secretEncrypted).secret;
    const path = buildUpstreamPath(req);
    const target = new URL(server.url);
    const transport = target.protocol === 'https:' ? https : http;

    const headers = { authorization: `Bearer ${secret}` };
    for (const name of FORWARD_REQUEST_HEADERS) {
      if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    }

    // Once we've answered (or aborted), late upstream events must not touch res again.
    let done = false;
    const fail = (status, message) => {
      if (done) return;
      done = true;
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(status).json({ error: message });
      }
    };

    const upstreamReq = transport.request({
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || undefined,
      path,
      method: req.method,
      headers,
    });

    upstreamReq.setTimeout(IDLE_TIMEOUT_MS, () => {
      fail(504, 'The server took too long to respond');
      upstreamReq.destroy();
    });

    upstreamReq.on('error', () => fail(502, 'Server unreachable'));

    upstreamReq.on('response', (upstreamRes) => {
      if (upstreamRes.statusCode === 401) {
        upstreamRes.resume();
        statusCache.markUnauthorized(server._id.toString());
        fail(502, ROTATE_MESSAGE);
        return;
      }

      if (/^text\/event-stream/i.test(upstreamRes.headers['content-type'] ?? '')) {
        upstreamReq.setTimeout(0);
      }

      res.status(upstreamRes.statusCode);
      for (const name of COPY_RESPONSE_HEADERS) {
        if (upstreamRes.headers[name] !== undefined) res.setHeader(name, upstreamRes.headers[name]);
      }
      res.flushHeaders();
      upstreamRes.on('error', () => fail(502, 'Server unreachable'));
      upstreamRes.on('end', () => {
        done = true;
      });
      upstreamRes.pipe(res);
    });

    // Not req 'close': that fires once the request body is consumed, not on client disconnect.
    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });

    req.pipe(upstreamReq);
  };
}
