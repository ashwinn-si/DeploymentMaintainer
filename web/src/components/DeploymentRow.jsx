import { Link } from 'react-router-dom';
import { StatusPill, statusTone } from './ui/StatusPill.jsx';
import { useServer } from '../context/ServerContext.jsx';
import { formatRelativeTime, formatDuration, shortSha } from '../lib/format.js';

const MODE_LABEL = { update: 'Update', fresh: 'Fresh', rollback: 'Rollback' };

export function DeploymentRow({ deployment, showApp = false }) {
  const { serverPath } = useServer();
  const { tone, pulse } = statusTone(deployment.status);
  return (
    <Link
      to={serverPath(`/deployments/${deployment.id}`)}
      className="glass-light flex flex-col gap-2 rounded-2xl border border-white/60 p-4 transition-colors hover:bg-white/70 dark:border-white/10 dark:hover:bg-black/30 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        <StatusPill tone={tone} pulse={pulse}>
          {deployment.status}
        </StatusPill>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
            {showApp ? `${deployment.appName} · ` : ''}#{deployment.number}
            {deployment.rollbackOf ? (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">rollback</span>
            ) : null}
            {deployment.autoRollbackOf ? (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">auto-rollback</span>
            ) : null}
          </p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {deployment.branch} · {MODE_LABEL[deployment.mode] ?? deployment.mode} · {shortSha(deployment.commitSha)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs text-[var(--text-muted)]">
        <span>{formatDuration(deployment.durationMs)}</span>
        <span>{formatRelativeTime(deployment.createdAt)}</span>
      </div>
    </Link>
  );
}
