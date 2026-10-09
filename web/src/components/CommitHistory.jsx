import { ExternalLink, GitCommit } from 'lucide-react';
import { StatusPill, statusTone } from './ui/StatusPill.jsx';
import { Loader } from './ui/Loader.jsx';
import { EmptyState } from './ui/EmptyState.jsx';
import { formatRelativeTime, shortSha, githubCommitUrl } from '../lib/format.js';

function Divider({ children }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{children}</span>
      <span className="h-px flex-1 bg-[var(--premium-border)]" />
    </div>
  );
}

function DeploymentBadge({ deployment }) {
  if (!deployment) return null;
  if (deployment.status === 'success') {
    return <StatusPill tone="teal">deployed #{deployment.number}</StatusPill>;
  }
  if (deployment.status === 'failed') {
    return <StatusPill tone="rose">failed #{deployment.number}</StatusPill>;
  }
  const { tone, pulse } = statusTone(deployment.status);
  // Queued/running/cancelled deployments aren't a result yet: show the state, not "deployed".
  return (
    <StatusPill tone={tone} pulse={pulse}>
      {deployment.status} #{deployment.number}
    </StatusPill>
  );
}

function CommitRow({ commit, repoFullName, live = false, notDeployed = false }) {
  const url = githubCommitUrl(repoFullName, commit.sha);
  return (
    <div
      className={[
        'surface-inset flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between',
        live ? 'border-teal-500/40 bg-teal-500/5' : 'border-[var(--premium-border)]',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-start gap-3">
        <GitCommit className={['mt-0.5 h-4 w-4 shrink-0', live ? 'text-teal-600 dark:text-teal-400' : 'text-[var(--text-muted)]'].join(' ')} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]" title={commit.message}>
            {commit.message || '(no message)'}
          </p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[var(--brand)] hover:underline">
                {shortSha(commit.sha)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono">{shortSha(commit.sha)}</span>
            )}
            {commit.author ? ` · ${commit.author}` : ''}
            {commit.date ? ` · ${formatRelativeTime(commit.date)}` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {live ? (
          <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">Live</span>
        ) : null}
        <DeploymentBadge deployment={commit.deployment} />
        {notDeployed && !commit.deployment ? <span className="text-[11px] text-[var(--text-muted)]">not deployed</span> : null}
      </div>
    </div>
  );
}

export function CommitHistory({ data, loading, error, repoFullName, branch }) {
  if (error) {
    return <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>;
  }
  if (!data) {
    return loading ? <Loader label="Loading commits…" /> : null;
  }

  const { deployed, newer, newerTotal, older } = data;
  if (!deployed && newer.length === 0 && older.length === 0) {
    return <EmptyState icon={GitCommit} title="No commits found" description={`GitHub returned no commits for ${branch}.`} />;
  }

  const hidden = Math.max(0, newerTotal - newer.length);
  const row = (c, props) => <CommitRow key={c.sha} commit={c} repoFullName={repoFullName} {...props} />;

  return (
    <div className="space-y-2">
      {data.neverDeployed ? (
        <p className="text-sm text-[var(--text-secondary)]">Not deployed yet — latest commits on {branch}</p>
      ) : null}
      {data.missing ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          The deployed commit no longer exists on GitHub (force-push?) — showing the latest commits
        </p>
      ) : null}

      {newer.length > 0 ? (
        <>
          <Divider>
            {newerTotal} newer {newerTotal === 1 ? 'commit' : 'commits'} not yet deployed
          </Divider>
          {hidden > 0 ? <p className="px-1 text-xs text-[var(--text-muted)]">+{hidden} more not shown</p> : null}
          {newer.map((c) => row(c, { notDeployed: true }))}
        </>
      ) : null}

      {deployed ? (
        <>
          <Divider>Deployed</Divider>
          {row(deployed, { live: true })}
        </>
      ) : null}

      {older.length > 0 ? (
        <>
          {data.neverDeployed || data.missing ? null : <Divider>Older commits</Divider>}
          {older.map((c) => row(c))}
        </>
      ) : null}
    </div>
  );
}
