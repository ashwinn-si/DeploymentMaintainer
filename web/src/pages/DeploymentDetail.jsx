import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Rocket, Square, RotateCcw, ExternalLink, AlertTriangle, Undo2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusPill, statusTone } from '../components/ui/StatusPill.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { Loader } from '../components/ui/Loader.jsx';
import { StepTimeline } from '../components/StepTimeline.jsx';
import { LogViewer } from '../components/LogViewer.jsx';
import { useDeploymentStream } from '../hooks/useDeploymentStream.js';
import { ApiError } from '../api.js';
import { useServer } from '../context/ServerContext.jsx';
import { formatDuration, formatRelativeTime, shortSha, githubCommitUrl } from '../lib/format.js';

export function DeploymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { server, api, serverPath } = useServer();
  const { deployment, entries, steps, status, loadError } = useDeploymentStream(server.id, id);
  const [stepFilter, setStepFilter] = useState('all');
  const [cancelling, setCancelling] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [autoRollbackDeployment, setAutoRollbackDeployment] = useState(null);

  useEffect(() => {
    if (!deployment) return;
    api.deployments
      .list({ app: deployment.appId, limit: 50 })
      .then((data) => {
        const match = data.deployments.find((d) => d.autoRollbackOf === deployment.id);
        setAutoRollbackDeployment(match ?? null);
      })
      .catch(() => {});
  }, [api, deployment?.id, deployment?.appId]);

  if (loadError) {
    return (
      <PageHeader icon={Rocket} eyebrow="Deployment" title="Not found">
        {loadError instanceof ApiError ? loadError.message : 'Could not load this deployment.'}
      </PageHeader>
    );
  }

  if (!deployment) {
    return <Loader label="Loading deployment…" />;
  }

  const { tone, pulse } = statusTone(status ?? deployment.status);
  const isRunning = status === 'running' || status === 'queued';
  const canRollback = status === 'success' && deployment.commitSha;
  const commitUrl = githubCommitUrl(deployment.repoFullName, deployment.commitSha);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.deployments.cancel(id);
      toast.success('Cancel requested');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    try {
      const { deployment: newDeployment } = await api.deployments.rollback(id);
      setRollbackOpen(false);
      toast.success('Rollback started');
      navigate(serverPath(`/deployments/${newDeployment.id}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start rollback');
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Rocket}
        eyebrow="Deployment"
        title={`${deployment.appName} #${deployment.number}`}
        actions={
          <>
            {isRunning ? (
              <Button size="sm" variant="danger" loading={cancelling} onClick={handleCancel}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : null}
            {canRollback ? (
              <Button size="sm" variant="ghost" onClick={() => setRollbackOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                Rollback to this
              </Button>
            ) : null}
            <Link to={serverPath(`/apps/${deployment.appId}`)}>
              <Button size="sm" variant="ghost">
                View app
              </Button>
            </Link>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone} pulse={pulse}>
            {status ?? deployment.status}
          </StatusPill>
          <span>
            {deployment.branch} · {deployment.mode} · node {deployment.nodeVersion}
          </span>
        </span>
      </PageHeader>

      {autoRollbackDeployment ? (
        <GlassCard variant="light" className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-[var(--text-secondary)]">
            This failure triggered an auto-rollback.{' '}
            <Link to={serverPath(`/deployments/${autoRollbackDeployment.id}`)} className="font-medium text-[var(--brand)] hover:underline">
              View deployment #{autoRollbackDeployment.number}
            </Link>
          </p>
        </GlassCard>
      ) : null}

      {deployment.autoRollbackOf ? (
        <GlassCard variant="light" className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/10">
          <Undo2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-[var(--text-secondary)]">
            This is an automatic rollback triggered by a failed health check on a previous deploy.
          </p>
        </GlassCard>
      ) : null}

      {deployment.restoredPrevious ? (
        <GlassCard variant="light" className="flex items-center gap-3 border border-teal-500/20 bg-teal-500/10">
          <Undo2 className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          <p className="text-sm text-[var(--text-secondary)]">
            This deploy failed after the new build went live, so the previous version was restored automatically. The app is serving the commit it had before.
          </p>
        </GlassCard>
      ) : null}

      {(status ?? deployment.status) === 'failed' && deployment.error ? (
        <GlassCard variant="light" className="border border-rose-500/20 bg-rose-500/10">
          <p className="mb-1 text-sm font-semibold text-rose-600 dark:text-rose-400">Deployment failed</p>
          <p className="text-sm text-[var(--text-secondary)]">{deployment.error}</p>
        </GlassCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Commit</p>
          {commitUrl ? (
            <a href={commitUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[var(--brand)] hover:underline">
              {shortSha(deployment.commitSha)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="font-mono">{shortSha(deployment.commitSha)}</span>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Previous → new</p>
          <p className="font-mono">
            {shortSha(deployment.previousSha)} → {shortSha(deployment.commitSha)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Started</p>
          <p>{formatRelativeTime(deployment.createdAt)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Duration</p>
          <p>{formatDuration(deployment.durationMs)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <GlassCard variant="light">
          <StepTimeline steps={steps} activeStepId={stepFilter} onSelect={(v) => setStepFilter((prev) => (prev === v ? 'all' : v))} />
        </GlassCard>
        <GlassCard variant="mid">
          <LogViewer
            entries={entries}
            steps={steps}
            stepFilter={stepFilter}
            onStepFilterChange={setStepFilter}
            downloadUrl={api.deployments.downloadUrl(id)}
            filename={`${deployment.appName}-${deployment.number}.log`}
          />
        </GlassCard>
      </div>

      <ConfirmDialog
        open={rollbackOpen}
        onClose={() => setRollbackOpen(false)}
        onConfirm={handleRollback}
        title="Rollback to this deployment"
        description={`This creates a new deployment that resets ${deployment.appName} to commit ${shortSha(deployment.commitSha)}, using the app's current environment and steps (not the ones from this deployment).`}
        confirmLabel="Rollback"
        tone="danger"
        loading={rollingBack}
      />
    </div>
  );
}
