import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listInstalled } from '../services/node.js';

export function createNodeRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/versions', async (req, res) => {
    let installed = [];
    try {
      installed = await listInstalled();
    } catch {
      installed = [];
    }
    res.json({ installed, default: config.DEFAULT_NODE_VERSION });
  });

  return router;
}
