import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { StatusPill } from '../components/ui/StatusPill.jsx';
import { portsApi } from '../api.js';
import { formatRelativeTime } from '../lib/format.js';

const POLL_MS = 10000;
const COLS = 'sm:grid-cols-[64px_1.3fr_1.3fr_1fr_70px_90px_100px_100px_110px]';

function ConflictNote({ reason }) {
  if (!reason) return null;
  return (
    <p title={reason} className="mt-1 truncate text-[11px] font-medium text-rose-500">
      {reason}
    </p>
  );
}

function PathCell({ row }) {
  if (row.nginx && row.path) {
    return <span className="font-mono text-[var(--text-secondary)]">{row.path}</span>;
  }
  return <StatusPill tone="amber">localhost only</StatusPill>;
}

function HealthCell({ health }) {
  if (!health || health.checkedAt === null) return <span className="text-[var(--text-muted)]">—</span>;
  return <StatusPill tone={health.ok ? 'teal' : 'rose'}>{health.ok ? 'healthy' : 'unhealthy'}</StatusPill>;
}

function DesktopRow({ row }) {
  return (
    <Link
      to={`/apps/${row.appId}`}
      className={`hidden sm:grid ${COLS} items-center gap-3 border-b border-black/[0.06] px-5 py-3 text-sm transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/5`}
    >
      <div>
        <span className="font-mono font-medium text-[var(--text-primary)]">{row.port}</span>
        {row.conflict ? <StatusPill tone="rose" className="mt-1">conflict</StatusPill> : null}
        <ConflictNote reason={row.conflict} />
      </div>
      <span className="truncate font-medium text-[var(--text-primary)]">{row.appName}</span>
      <span className="truncate text-[var(--text-muted)]">
        {row.repoFullName} @ {row.branch}
      </span>
      <PathCell row={row} />
      <span className="font-mono text-xs text-[var(--text-muted)]">{row.nodeVersion}</span>
      <span className="text-[var(--text-muted)]">{row.pm2Status ?? '—'}</span>
      <HealthCell health={row.health} />
      <StatusPill tone={row.nginx ? 'teal' : 'neutral'}>{row.nginx ? 'on' : 'off'}</StatusPill>
      <span className="text-xs text-[var(--text-muted)]">{formatRelativeTime(row.lastDeployedAt)}</span>
    </Link>
  );
}

function MobileCard({ row }) {
  return (
    <Link
      to={`/apps/${row.appId}`}
      className="glass-light block space-y-2 rounded-2xl border border-white/60 p-4 dark:border-white/10 sm:hidden"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">Port {row.port}</span>
        {row.conflict ? <StatusPill tone="rose">conflict</StatusPill> : <StatusPill tone={row.nginx ? 'teal' : 'neutral'}>{row.nginx ? 'nginx on' : 'nginx off'}</StatusPill>}
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{row.appName}</p>
      <p className="truncate text-xs text-[var(--text-muted)]">
        {row.repoFullName} @ {row.branch}
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <PathCell row={row} />
        <HealthCell health={row.health} />
        <span className="text-xs text-[var(--text-muted)]">Node {row.nodeVersion}</span>
      </div>
      <ConflictNote reason={row.conflict} />
      <p className="text-xs text-[var(--text-muted)]">Deployed {formatRelativeTime(row.lastDeployedAt)}</p>
    </Link>
  );
}

export function Ports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await portsApi.list();
        if (!cancelled) setData(result);
      } catch {
        // keep whatever we last had on a transient error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader icon={Plug} eyebrow="Network" title="Ports">
        Port allocation, path routing and conflicts across every app.
      </PageHeader>

      {!loading && !data ? (
        <EmptyState icon={Plug} title="Couldn't load ports" description="Try refreshing the page." />
      ) : (
        <GlassCard variant="mid" className="!p-0 overflow-hidden">
          <div className={`hidden ${COLS} gap-3 border-b border-black/[0.06] px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] dark:border-white/10 sm:grid`}>
            <span>Port</span>
            <span>App</span>
            <span>Repo @ branch</span>
            <span>Path</span>
            <span>Node</span>
            <span>PM2</span>
            <span>Health</span>
            <span>Nginx</span>
            <span>Last deploy</span>
          </div>

          <div className="space-y-3 p-3 sm:space-y-0 sm:p-0">
            <div className="glass-light rounded-2xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-4 sm:rounded-none sm:border-0 sm:border-b sm:border-black/[0.06] sm:bg-transparent sm:p-0 sm:dark:border-white/10">
              <div className={`sm:grid ${COLS} items-center gap-3 sm:px-5 sm:py-3`}>
                <span className="font-mono text-sm font-semibold text-[var(--brand)]">{data?.dashboard?.port ?? '—'}</span>
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  Deploy Maintainer
                  <span className="rounded-full bg-[var(--brand)]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]">dashboard</span>
                </span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">/</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
                <span className="hidden text-[var(--text-muted)] sm:inline">—</span>
              </div>
            </div>

            {rows.map((row) => (
              <div key={row.appId}>
                <DesktopRow row={row} />
                <MobileCard row={row} />
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
