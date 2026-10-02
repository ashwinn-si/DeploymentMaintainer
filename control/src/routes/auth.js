import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import User from '../models/User.js';
import { issueSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A precomputed dummy hash so the bcrypt.compare cost is paid even when the
// email doesn't exist, keeping the unknown-email and wrong-password paths
// close in timing without needing constant-time string comparison tricks.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export function createAuthRouter(config) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again later.' },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });

    const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches) {
      return res.status(401).json({ error: INVALID_CREDENTIALS_MESSAGE });
    }

    issueSessionCookie(res, user, config);
    return res.json({ user: { id: user._id.toString(), email: user.email } });
  });

  router.post('/logout', (req, res) => {
    clearSessionCookie(res, config);
    return res.json({ ok: true });
  });

  router.get('/me', requireAuth(config), (req, res) => {
    return res.json({ user: { id: req.user._id.toString(), email: req.user.email } });
  });

  return router;
}
