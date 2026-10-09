import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { listRepos, listBranches, detectNodeVersion, detectProjectType, listDirectories } from '../services/github.js';
import { validateRef, validateRootDir } from '../lib/validate.js';

const nodeVersionQuerySchema = z.object({ ref: z.string().min(1), root: z.string().optional() });
const treeQuerySchema = z.object({ branch: z.string().min(1), path: z.string().optional() });

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
    const { ref, root } = nodeVersionQuerySchema.parse(req.query);
    const result = await detectNodeVersion(config, req.params.owner, req.params.repo, ref, root ?? '');
    res.json(result);
  });

  router.get('/:owner/:repo/detect-project', async (req, res) => {
    const { ref, root } = nodeVersionQuerySchema.parse(req.query);
    const result = await detectProjectType(config, req.params.owner, req.params.repo, ref, root ?? '');
    res.json(result);
  });

  // Sub-folders of `path` ('' = repo root) on `branch`, for the root-directory picker.
  router.get('/:owner/:repo/tree', async (req, res) => {
    const { branch, path: dirPath } = treeQuerySchema.parse(req.query);
    const normalised = validateRootDir(dirPath ?? '');
    const directories = await listDirectories(config, req.params.owner, req.params.repo, validateRef(branch), normalised);
    res.json({ path: normalised, directories });
  });

  return router;
}
