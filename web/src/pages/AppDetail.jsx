import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AppWindow, Rocket, RotateCw, Square, Copy, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import { StatusPill, statusTone } from '../components/ui/StatusPill.jsx';
import { Loader } from '../components/ui/Loader.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { EnvEditor } from '../components/EnvEditor.jsx';
import { StepsEditor } from '../components/StepsEditor.jsx';
import { DeployDialog } from '../components/DeployDialog.jsx';
import { DuplicateDialog } from '../components/DuplicateDialog.jsx';
import { DeploymentRow } from '../components/DeploymentRow.jsx';
import { appsApi, ApiError } from '../api.js';
import { formatBytes, formatDuration, formatRelativeTime, shortSha, githubCommitUrl } from '../lib/format.js';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'environment', label: 'Environment' },
  { value: 'steps', label: 'Steps' },
  { value: 'deployments', label: 'Deployments' },
  { value: 'logs', label: 'Runtime logs' },
];

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <div className="text-sm text-[var(--text-primary)]">{children}</div>
    </div>
  );
}

function OverviewTab({ app }) {
  const commitUrl = githubCommitUrl(app.repoFullName, app.currentCommitSha);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Repository">
        <a href={`https://github.com/${app.repoFullName}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--brand)] hover:underline">
          {app.repoFullName}
          <ExternalLink className="h-3 w-3" />
        </a>
      </Field>
      <Field label="Branch">{app.branch}</Field>
      <Field label="Commit">
        {commitUrl ? (
          <a href={commitUrl} target="_blank" rel="noreferrer" className="font-mono text-[var(--brand)] hover:underline">
            {shortSha(app.currentCommitSha)}
          </a>
        ) : (
          <span className="font-mono">{shortSha(app.currentCommitSha)}</span>
        )}
      </Field>
      <Field label="Port">{app.port}</Field>
      <Field label="Path">{app.path ?? 'localhost only'}</Field>
      <Field label="Node version">{app.nodeVersion}</Field>
      <Field label="PM2 status">{app.pm2?.status ?? '—'}</Field>
      <Field label="CPU">{app.pm2?.cpu !== null ? `${app.pm2.cpu}%` : '—'}</Field>
      <Field label="Memory">{formatBytes(app.pm2?.memory)}</Field>
      <Field label="Restarts">{app.pm2?.restarts ?? '—'}</Field>
      <Field label="Uptime">{formatDuration(app.pm2?.uptimeMs)}</Field>
      <Field label="Disk usage">{formatBytes(app.diskBytes)}</Field>
      <Field label="Last deployed">{formatRelativeTime(app.lastDeployedAt)}</Field>
    </div>
  );
}

export function AppDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [app, setApp] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deployments, setDeployments] = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const tab = TABS.some((t) => t.value === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const setTab = (value) => setSearchParams((prev) => ({ ...Object.fromEntries(prev), tab: value }));

  const load = useCallback(async () => {
    try {
      const data = await appsApi.get(id);
      setApp(data.app);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'deployments') {
      appsApi
        .deployments(id)
        .then((data) => setDeployments(data.deployments))
        .catch(() => {});
    }
  }, [tab, id]);

  const loadLogs = useCallback(() => {
    setLogsLoading(true);
    appsApi
      .logs(id)
      .then((data) => setRuntimeLogs(data.text))
      .catch(() => setRuntimeLogs('Could not load runtime logs.'))
      .finally(() => setLogsLoading(false));
  }, [id]);

  useEffect(() => {
    if (tab === 'logs') loadLogs();
  }, [tab, loadLogs]);

  const runAction = async (action, fn) => {
    setBusy(action);
    try {
      await fn();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveEnv = (env) => runAction('env', async () => {
    await appsApi.update(id, { env });
    toast.success('Environment saved — takes effect on the next deploy');
  });

  const handleSaveSteps = (steps) => runAction('steps', async () => {
    await appsApi.update(id, { steps });
    toast.success('Steps saved — takes effect on the next deploy');
  });

  const handleDelete = async () => {
    setBusy('delete');
    try {
      await appsApi.remove(id, app.name);
      toast.success(`${app.name} deleted`);
      navigate('/');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete app');
      setBusy(null);
    }
  };

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageHeader icon={AppWindow} eyebrow="App" title="Not found">
          This app doesn't exist, or was deleted.
        </PageHeader>
      </div>
    );
  }

  if (!app) {
    return <Loader label="Loading app…" />;
  }

  const { tone, pulse } = statusTone(app.status);
  const deploying = Boolean(app.activeDeploymentId);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={AppWindow}
        eyebrow="App"
        title={app.name}
        actions={
          <>
            <Button size="sm" loading={deploying} onClick={() => setDeployOpen(true)}>
              <Rocket className="h-4 w-4" />
              Deploy
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'restart'} onClick={() => runAction('restart', () => appsApi.restart(id))}>
              <RotateCw className="h-4 w-4" />
              Restart
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'stop'} onClick={() => runAction('stop', () => appsApi.stop(id))}>
              <Square className="h-4 w-4" />
              Stop
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDuplicateOpen(true)}>
              <Copy className="h-4 w-4" />
              Duplicate
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone} pulse={pulse}>
            {app.status.replace('_', ' ')}
          </StatusPill>
          <StatusPill tone={app.health?.ok ? 'teal' : 'rose'}>{app.health?.ok ? 'healthy' : 'unhealthy'}</StatusPill>
          <span>
            {app.repoFullName} @ {app.branch}
          </span>
        </span>
      </PageHeader>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <GlassCard variant="mid">
        {tab === 'overview' ? <OverviewTab app={app} /> : null}
        {tab === 'environment' ? (
          <div className="space-y-4">
            <EnvEditorSaveable initial={app.env} onSave={handleSaveEnv} busy={busy === 'env'} />
          </div>
        ) : null}
        {tab === 'steps' ? <StepsEditorSaveable initial={app.steps} onSave={handleSaveSteps} busy={busy === 'steps'} /> : null}
        {tab === 'deployments' ? (
          <div className="space-y-2">
            {deployments.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No deployments yet.</p>
            ) : (
              deployments.map((d) => <DeploymentRow key={d.id} deployment={d} />)
            )}
          </div>
        ) : null}
        {tab === 'logs' ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" loading={logsLoading} onClick={loadLogs}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
            <pre className="custom-scrollbar max-h-[60vh] overflow-y-auto rounded-2xl border border-black/[0.06] bg-black/[0.03] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] dark:border-white/10 dark:bg-black/40">
              {runtimeLogs || 'No output yet.'}
            </pre>
          </div>
        ) : null}
      </GlassCard>

      <DeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} app={app} />
      <DuplicateDialog open={duplicateOpen} onClose={() => setDuplicateOpen(false)} app={app} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title={`Delete ${app.name}`}
        description="This stops the app, removes it from PM2 and Nginx, and deletes its folder and deployment history. This can't be undone."
        confirmLabel="Delete app"
        tone="danger"
        confirmText={app.name}
        loading={busy === 'delete'}
      />
    </div>
  );
}

function EnvEditorSaveable({ initial, onSave, busy }) {
  const [env, setEnv] = useState(initial);
  const dirty = JSON.stringify(env) !== JSON.stringify(initial);
  return (
    <div className="space-y-4">
      <EnvEditor value={env} onChange={setEnv} />
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty} loading={busy} onClick={() => onSave(env)}>
          Save environment
        </Button>
      </div>
    </div>
  );
}

function StepsEditorSaveable({ initial, onSave, busy }) {
  const [steps, setSteps] = useState(initial);
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial);
  return (
    <div className="space-y-4">
      <StepsEditor value={steps} onChange={setSteps} />
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty} loading={busy} onClick={() => onSave(steps)}>
          Save steps
        </Button>
      </div>
    </div>
  );
}
