// A realistic deploy log, replayed by the hero mock and the live-logs feature mock.
export const DEPLOY_LOG = [
  { kind: 'step', text: 'Sync repository' },
  { kind: 'cmd', text: 'git pull origin main' },
  { kind: 'info', text: 'HEAD is now at a1b2c3d  fix: retry webhook' },
  { kind: 'step', text: 'Install dependencies' },
  { kind: 'cmd', text: 'npm ci' },
  { kind: 'info', text: 'added 214 packages in 9s' },
  { kind: 'step', text: 'Start or restart with PM2' },
  { kind: 'cmd', text: 'pm2 start ecosystem.config.cjs --update-env' },
  { kind: 'step', text: 'Nginx routing' },
  { kind: 'ok', text: 'route /shop-api updated, nginx reloaded' },
  { kind: 'ok', text: 'Deploy succeeded in 24s' },
];

export const LOG_TONE = {
  step: 'text-[var(--brand)] font-semibold',
  cmd: 'text-[var(--text-primary)]',
  info: 'text-[var(--text-muted)]',
  ok: 'text-emerald-600 dark:text-emerald-400 font-semibold',
};

export const LOG_PREFIX = { step: '▸', cmd: '$', info: ' ', ok: '✓' };
