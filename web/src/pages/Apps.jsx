import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LayoutGrid, PlusCircle, Rocket, ExternalLink, Globe, Server, Github, GitBranch, Link2, Clock, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusPill, statusTone } from '../components/ui/StatusPill.jsx';
import { ActivityPanel } from '../components/ActivityPanel.jsx';
import { ServerHealthCard } from '../components/ServerHealthCard.jsx';
import { ApiError } from '../api.js';
import { useServer } from '../context/ServerContext.jsx';
import { formatRelativeTime } from '../lib/format.js';

function publicUrl(serverUrl, path) {
  if (!path) return null;
  return `${String(serverUrl ?? '').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function AppCard({ app, onDeploy }) {
  const { server, serverPath } = useServer();
  const fullUrl = publicUrl(server.url, app.path);
  const { tone, pulse } = statusTone(app.status);
  const deploying = Boolean(app.activeDeploymentId);
  const isSite = app.kind === 'static';
  const showHealth = app.healthMonitoring && app.status !== 'not_deployed';
  const typeLabel = isSite ? 'Website' : 'Backend';
  const detail = isSite ? 'Static files via Nginx' : `Node ${app.nodeVersion} · port ${app.port}`;

  // The whole card is one link; buttons sit above it and opt back in to pointer events.
  return (
    <GlassCard variant="mid" interactive className="relative flex flex-col gap-4">
      <Link to={serverPath(`/apps/${app.id}`)} className="absolute inset-0 z-0 rounded-[inherit]" aria-label={`Open ${app.name}`} />

      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="truncate text-base font-bold text-[var(--text-primary)]">{app.name}</h3>
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            {isSite ? <Globe className="h-3.5 w-3.5 shrink-0" /> : <Server className="h-3.5 w-3.5 shrink-0" />}
            {typeLabel} · {detail}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill tone={tone} pulse={pulse}>
            {app.status.replace('_', ' ')}
          </StatusPill>
          {showHealth ? <StatusPill tone={app.health?.ok ? 'teal' : 'rose'}>{app.health?.ok ? 'healthy' : 'unhealthy'}</StatusPill> : null}
        </div>
      </div>

      <dl className="pointer-events-none relative z-10 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Github className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <span className="truncate">{app.repoFullName}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
            <GitBranch className="h-3 w-3" />
            {app.branch}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{fullUrl ?? 'localhost only'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Deployed {formatRelativeTime(app.lastDeployedAt)}
        </div>
      </dl>

      <div className="relative z-10 mt-auto flex items-center gap-2 border-t border-[var(--premium-border)] pt-4">
        <Button
          type="button"
          size="sm"
          loading={deploying}
          onClick={() => onDeploy(app)}
        >
          <Rocket className="h-4 w-4" />
          {deploying ? 'Deploying' : 'Deploy'}
        </Button>
        {/* Backends are APIs, not pages, so a "Visit" button would only open a blank response. */}
        {isSite && fullUrl ? (
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[38px] items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-[var(--text-muted)] ui-transition hover:bg-base-300 hover:text-[var(--text-primary)]"
          >
            <ExternalLink className="h-4 w-4" />
            Visit
          </a>
        ) : null}
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-[var(--text-muted)]">
          Details <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </GlassCard>
  );
}

export function Apps() {
  const { activeDeployments = [] } = useOutletContext() ?? {};
  const navigate = useNavigate();
  const { api, serverPath } = useServer();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.apps.list();
      setApps(data.apps);
    } catch {
      // keep previous list; page still renders with what it has
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load, activeDeployments.length]);

  const handleDeploy = async (app) => {
    try {
      const { deployment } = await api.apps.deploy(app.id, { mode: 'update' });
      toast.success(
        <span className="flex items-center gap-2">
          <span>Deploy started · {app.name}</span>
          <button type="button" onClick={() => navigate(serverPath(`/deployments/${deployment.id}`))} className="font-semibold text-[var(--brand)] hover:underline">
            View log
          </button>
        </span>
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start deployment');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={LayoutGrid} eyebrow="Projects" title="Apps" actions={
        <Link to={serverPath('/new')}>
          <Button size="md">
            <PlusCircle className="h-4 w-4" />
            New App
          </Button>
        </Link>
      }>
        An app is one GitHub repo deployed on this server. Click a card to manage it.
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActivityPanel active={activeDeployments} />
        <ServerHealthCard />
      </div>

      {!loading && apps.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No apps yet"
          description="Deploy your first app from a GitHub repo."
          action={
            <Link to={serverPath('/new')}>
              <Button>
                <PlusCircle className="h-4 w-4" />
                New App
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} onDeploy={handleDeploy} />
          ))}
        </div>
      )}
    </div>
  );
}
