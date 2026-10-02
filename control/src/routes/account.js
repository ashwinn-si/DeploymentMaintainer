import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, issueSessionCookie } from '../middleware/auth.js';
import { HttpError } from '../lib/httpError.js';

const BCRYPT_COST = 12;

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

export function createAccountRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  // This endpoint also accepts a password guess, so it gets the login limiter's budget.
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });

  router.post('/password', passwordLimiter, async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = req.user;

    const matches = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!matches) {
      // 400, not 401: the UI treats any 401 as "dashboard session expired" and logs out.
      throw new HttpError(400, 'Current password is incorrect');
    }
    if (body.newPassword === body.currentPassword) {
      throw new HttpError(400, 'New password must be different from the current password');
    }

    user.passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);
    user.tokenVersion += 1;
    await user.save();

    issueSessionCookie(res, user, config);
    res.json({ ok: true });
  });

  return router;
}
