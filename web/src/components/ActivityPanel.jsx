import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Rocket } from 'lucide-react';
import { GlassCard } from './ui/GlassCard.jsx';
import { StatusPill, statusTone } from './ui/StatusPill.jsx';
import { EmptyState } from './ui/EmptyState.jsx';
import { useServer } from '../context/ServerContext.jsx';
import { formatRelativeTime } from '../lib/format.js';

function currentStepLabel(deployment) {
  const running = deployment.steps?.find((s) => s.status === 'running');
  if (running) return running.label ?? running.type;
  const lastDone = [...(deployment.steps ?? [])].reverse().find((s) => s.status === 'success' || s.status === 'failed');
  return lastDone ? `after ${lastDone.label ?? lastDone.type}` : 'starting…';
}

function LiveDeployRow({ deployment }) {
  const { api, serverPath } = useServer();
  const [lines, setLines] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.deployments.entries(deployment.id, -1, 500);
        if (!cancelled) setLines(data.entries.slice(-8));
      } catch {
        // keep last known lines on a transient error
      }
    }
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment.id]);

  return (
    <Link
      to={serverPath(`/deployments/${deployment.id}`)}
      className="block rounded-2xl border border-white/60 bg-white/40 p-3 transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-black/20 dark:hover:bg-black/30"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill tone="brand" pulse>
            {deployment.appName}
          </StatusPill>
          <span className="text-xs text-[var(--text-muted)]">
            #{deployment.number} · {deployment.branch}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{currentStepLabel(deployment)}</span>
      </div>
      <div className="custom-scrollbar max-h-24 overflow-y-auto rounded-xl bg-black/[0.03] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)] dark:bg-black/40">
        {lines.length === 0 ? <span className="text-[var(--text-muted)]">Waiting for output…</span> : lines.map((l) => <div key={l.i}>{l.text}</div>)}
      </div>
    </Link>
  );
}

function FinishedRow({ deployment }) {
  const { serverPath } = useServer();
  const { tone } = statusTone(deployment.status);
  return (
    <Link
      to={serverPath(`/deployments/${deployment.id}`)}
      className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
    >
      <span className="flex items-center gap-2 truncate">
        <StatusPill tone={tone}>{deployment.status}</StatusPill>
        <span className="truncate text-[var(--text-primary)]">{deployment.appName}</span>
        <span className="shrink-0 text-[var(--text-muted)]">#{deployment.number}</span>
      </span>
      <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatRelativeTime(deployment.finishedAt ?? deployment.createdAt)}</span>
    </Link>
  );
}

export function ActivityPanel({ active = [] }) {
  const { api } = useServer();
  const [finished, setFinished] = useState([]);
  const activeCountRef = useRef(active.length);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.deployments.list({ limit: 10 });
        if (!cancelled) {
          setFinished(data.deployments.filter((d) => d.status !== 'running' && d.status !== 'queued').slice(0, 10));
        }
      } catch {
        // leave previous list on error
      }
    }
    // Reload whenever an active deployment appears to have finished.
    if (active.length !== activeCountRef.current || finished.length === 0) {
      load();
    }
    activeCountRef.current = active.length;
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.length]);

  return (
    <GlassCard variant="mid">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--brand)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Activity</h2>
      </div>

      {active.length > 0 ? (
        <div className="mb-4 space-y-2">
          {active.map((d) => (
            <LiveDeployRow key={d.id} deployment={d} />
          ))}
        </div>
      ) : null}

      {finished.length > 0 ? (
        <div className="space-y-0.5">{finished.map((d) => <FinishedRow key={d.id} deployment={d} />)}</div>
      ) : active.length === 0 ? (
        <EmptyState icon={Rocket} title="No activity yet" description="Deployments will show up here as they happen." />
      ) : null}
    </GlassCard>
  );
}
