import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { StatusPill } from '../components/ui/StatusPill.jsx';
import { useServer } from '../context/ServerContext.jsx';
import { formatRelativeTime } from '../lib/format.js';

const POLL_MS = 10000;
const COLS = 'sm:grid-cols-[84px_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_110px]';

function ConflictNote({ reason }) {
  if (!reason) return null;
  return (
    <p title={reason} className="mt-1 text-[11px] font-medium text-rose-500">
      {reason}
    </p>
  );
}

function PathCell({ row }) {
  if (row.nginx && row.path) {
    return <span className="break-all font-mono text-xs text-[var(--text-secondary)]">{row.path}/</span>;
  }
  return <StatusPill tone="amber">not published</StatusPill>;
}

// What is actually running behind the port: PM2 state plus whether anything is really listening on it.
function ProcessCell({ row }) {
  if (row.kind === 'static') {
    return <span className="text-xs text-[var(--text-muted)]">Static files · no process</span>;
  }
  const status = row.pm2Status;
  const tone = status === 'online' ? 'teal' : status === 'errored' ? 'rose' : 'amber';
  const label = status ?? 'not started';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={tone}>{label}</StatusPill>
        {row.healthMonitoring && row.health?.checkedAt ? (
          <StatusPill tone={row.health.ok ? 'teal' : 'rose'}>{row.health.ok ? 'healthy' : 'unhealthy'}</StatusPill>
        ) : null}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        {row.listening ? 'Port is accepting connections' : status === 'errored' ? 'Crashed: check the deploy log' : 'Nothing listening on this port'}
      </p>
    </div>
  );
}

function PortCell({ row }) {
  return (
    <div>
      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{row.port ?? '—'}</span>
      {row.conflict ? <StatusPill tone="rose" className="mt-1">conflict</StatusPill> : null}
    </div>
  );
}

function AppCell({ row }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{row.appName}</p>
      <p className="truncate text-xs text-[var(--text-muted)]">
        {row.repoFullName} @ {row.branch}
      </p>
    </div>
  );
}

function DesktopRow({ row }) {
  const { serverPath } = useServer();
  return (
    <Link
      to={serverPath(`/apps/${row.appId}`)}
      className={`hidden sm:grid ${COLS} items-start gap-4 border-b border-[var(--premium-border)] px-5 py-4 transition-colors hover:bg-base-200`}
    >
      <div>
        <PortCell row={row} />
        <ConflictNote reason={row.conflict} />
      </div>
      <AppCell row={row} />
      <div className="pt-0.5">
        <PathCell row={row} />
      </div>
      <ProcessCell row={row} />
      <span className="pt-0.5 text-xs text-[var(--text-muted)]">{formatRelativeTime(row.lastDeployedAt)}</span>
    </Link>
  );
}

function MobileCard({ row }) {
  const { serverPath } = useServer();
  return (
    <Link
      to={serverPath(`/apps/${row.appId}`)}
      className="surface-inset block space-y-3 rounded-2xl p-4 sm:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <AppCell row={row} />
        <PortCell row={row} />
      </div>
      <ProcessCell row={row} />
      <div className="flex flex-wrap items-center gap-2">
        <PathCell row={row} />
        <span className="text-xs text-[var(--text-muted)]">Deployed {formatRelativeTime(row.lastDeployedAt)}</span>
      </div>
      <ConflictNote reason={row.conflict} />
    </Link>
  );
}

export function Ports() {
  const { api } = useServer();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.ports.list();
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
  }, [api]);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader icon={Plug} eyebrow="This server" title="Ports & routes">
        Each backend listens on a port; Nginx publishes every app under a URL path. This shows both, and flags clashes.
      </PageHeader>

      {!loading && !data ? (
        <EmptyState icon={Plug} title="Couldn't load ports" description="Try refreshing the page." />
      ) : (
        <GlassCard variant="mid" className="!p-0 overflow-hidden">
          <div className={`hidden ${COLS} gap-4 border-b border-[var(--premium-border)] bg-base-200 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] sm:grid`}>
            <span>Port</span>
            <span>App</span>
            <span>Public URL path</span>
            <span>Process</span>
            <span>Last deploy</span>
          </div>

          <div className="space-y-3 p-3 sm:space-y-0 sm:p-0">
            <div className="surface-inset rounded-2xl bg-[var(--brand-soft)] p-4 sm:rounded-none sm:border-0 sm:border-b sm:border-[var(--premium-border)] sm:bg-transparent sm:px-5 sm:py-4">
              <div className={`grid grid-cols-[auto_1fr] items-start gap-4 ${COLS} sm:items-start`}>
                <span className="font-mono text-sm font-semibold text-[var(--brand)]">{data?.dashboard?.port ?? '—'}</span>
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    Deploy Maintainer
                    <span className="rounded-full bg-[var(--brand)]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]">this dashboard</span>
                  </p>
                  <p className="text-xs text-[var(--text-muted)] sm:hidden">Served at /</p>
                </div>
                <span className="hidden font-mono text-xs text-[var(--text-secondary)] sm:inline sm:pt-0.5">/</span>
                <span className="hidden text-xs text-[var(--text-muted)] sm:inline">Running (you are here)</span>
                <span className="hidden sm:inline" />
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
