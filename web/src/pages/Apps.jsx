import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LayoutGrid, PlusCircle, Rocket, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusPill, statusTone } from '../components/ui/StatusPill.jsx';
import { ActivityPanel } from '../components/ActivityPanel.jsx';
import { ServerHealthCard } from '../components/ServerHealthCard.jsx';
import { appsApi, ApiError } from '../api.js';
import { formatRelativeTime } from '../lib/format.js';

function AppCard({ app, onDeploy }) {
  const { tone, pulse } = statusTone(app.status);
  const healthTone = app.health?.ok ? 'teal' : app.status === 'not_deployed' ? 'neutral' : 'rose';
  const deploying = Boolean(app.activeDeploymentId);

  return (
    <GlassCard variant="mid" interactive className="relative flex flex-col gap-4">
      <Link to={`/apps/${app.id}`} className="absolute inset-0" aria-label={`Open ${app.name}`} />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{app.name}</h3>
          <p className="truncate text-xs text-[var(--text-muted)]">{app.path ?? 'localhost only'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill tone={tone} pulse={pulse}>
            {app.status.replace('_', ' ')}
          </StatusPill>
          {app.status !== 'not_deployed' ? <StatusPill tone={healthTone}>{app.health?.ok ? 'healthy' : 'unhealthy'}</StatusPill> : null}
        </div>
      </div>

      <div className="relative z-10 space-y-1 text-sm text-[var(--text-secondary)]">
        <p className="truncate">
          {app.repoFullName} <span className="text-[var(--text-muted)]">@ {app.branch}</span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Node {app.nodeVersion} · port {app.port} · deployed {formatRelativeTime(app.lastDeployedAt)}
        </p>
      </div>

      <div className="relative z-10 mt-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          loading={deploying}
          onClick={(e) => {
            e.preventDefault();
            onDeploy(app);
          }}
        >
          <Rocket className="h-4 w-4" />
          {deploying ? 'Deploying' : 'Deploy'}
        </Button>
        {app.path ? (
          <a
            href={app.path}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 flex min-h-[38px] items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Visit
          </a>
        ) : null}
      </div>
    </GlassCard>
  );
}

export function Apps({ activeDeployments = [] }) {
  const navigate = useNavigate();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await appsApi.list();
      setApps(data.apps);
    } catch {
      // keep previous list; page still renders with what it has
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, activeDeployments.length]);

  const handleDeploy = async (app) => {
    try {
      const { deployment } = await appsApi.deploy(app.id, { mode: 'update' });
      toast.success(
        <span className="flex items-center gap-2">
          <span>Deploy started · {app.name}</span>
          <button type="button" onClick={() => navigate(`/deployments/${deployment.id}`)} className="font-semibold text-[var(--brand)] hover:underline">
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
      <PageHeader icon={LayoutGrid} eyebrow="Dashboard" title="Apps" actions={
        <Link to="/new">
          <Button size="md">
            <PlusCircle className="h-4 w-4" />
            New App
          </Button>
        </Link>
      }>
        Your deployed applications, at a glance.
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
            <Link to="/new">
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
