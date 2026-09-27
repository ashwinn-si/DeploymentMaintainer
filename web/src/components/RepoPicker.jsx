import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Lock, Github } from 'lucide-react';
import { Input } from './ui/Input.jsx';
import { Button } from './ui/Button.jsx';
import { reposApi, ApiError } from '../api.js';
import { formatRelativeTime } from '../lib/format.js';

export function RepoPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await reposApi.list(query, refresh);
      setRepos(data.repos);
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error('Failed to load repos'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input icon={Search} placeholder="Search repos…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => load(true)} title="Refresh from GitHub">
          <RefreshCw className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />
        </Button>
      </div>

      {error ? (
        <div className="glass-light rounded-2xl p-4 text-sm text-rose-500">
          {error.status === 503
            ? 'GitHub token is not configured on the server — ask an admin to set GITHUB_TOKEN.'
            : error.message}
        </div>
      ) : null}

      <div className="custom-scrollbar max-h-80 space-y-2 overflow-y-auto">
        {!error && !loading && repos.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No repositories found.</p> : null}
        {repos.map((repo) => (
          <button
            key={repo.fullName}
            type="button"
            onClick={() => onChange(repo.fullName)}
            className={[
              'flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
              value === repo.fullName
                ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                : 'border-white/60 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/5',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--text-primary)]">
                <Github className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                <span className="truncate">{repo.fullName}</span>
                {repo.private ? <Lock className="h-3 w-3 shrink-0 text-[var(--text-muted)]" /> : null}
              </p>
              {repo.description ? <p className="truncate text-xs text-[var(--text-muted)]">{repo.description}</p> : null}
            </div>
            <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatRelativeTime(repo.pushedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
