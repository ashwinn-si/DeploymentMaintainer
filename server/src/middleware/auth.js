import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

// One limiter per config, shared by every router that calls requireAuth(config).
const limiters = new WeakMap();

function tokenMatches(req, secretDigest) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) return false;
  // Equal-length digests let timingSafeEqual run without leaking the secret's length.
  return crypto.timingSafeEqual(sha256(match[1].trim()), secretDigest);
}

export function requireAuth(config) {
  const secretDigest = sha256(config.SERVER_SECRET);

  if (!limiters.has(config)) {
    limiters.set(
      config,
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        // A valid secret is never counted or blocked, even from an IP that has been guessing.
        skip: (req) => tokenMatches(req, secretDigest),
        message: { error: 'Too many failed attempts. Please try again later.' },
      }),
    );
  }
  const failedAttemptLimiter = limiters.get(config);

  return function authMiddleware(req, res, next) {
    if (tokenMatches(req, secretDigest)) return next();
    failedAttemptLimiter(req, res, (err) => {
      if (err) return next(err);
      res.status(401).json({ error: 'Invalid server secret' });
    });
  };
}
