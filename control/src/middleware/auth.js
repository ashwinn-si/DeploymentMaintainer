import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const SESSION_COOKIE_NAME = 'dm_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
  };
}

export function issueSessionCookie(res, user, config) {
  const token = jwt.sign(
    { sub: user._id.toString(), tokenVersion: user.tokenVersion },
    config.JWT_SECRET,
    { expiresIn: '7d' },
  );
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions(config),
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(config));
}

export function requireAuth(config) {
  return async function authMiddleware(req, res, next) {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let payload;
    try {
      payload = jwt.verify(token, config.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    req.user = user;
    next();
  };
}
