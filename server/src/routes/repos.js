import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { listRepos, listBranches, detectNodeVersion, detectProjectType } from '../services/github.js';

const nodeVersionQuerySchema = z.object({ ref: z.string().min(1) });

export function createReposRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const q = typeof req.query.q === 'string' && req.query.q.length > 0 ? req.query.q : undefined;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const repos = await listRepos(config, { q, refresh });
    res.json({ repos });
  });

  router.get('/:owner/:repo/branches', async (req, res) => {
    const branches = await listBranches(config, req.params.owner, req.params.repo);
    res.json({ branches });
  });

  router.get('/:owner/:repo/node-version', async (req, res) => {
    const { ref } = nodeVersionQuerySchema.parse(req.query);
    const result = await detectNodeVersion(config, req.params.owner, req.params.repo, ref);
    res.json(result);
  });

  router.get('/:owner/:repo/detect-project', async (req, res) => {
    const { ref } = nodeVersionQuerySchema.parse(req.query);
    const result = await detectProjectType(config, req.params.owner, req.params.repo, ref);
    res.json(result);
  });

  return router;
}
