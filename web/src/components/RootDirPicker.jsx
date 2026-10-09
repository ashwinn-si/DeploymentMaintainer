import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal.jsx';
import { Button } from './ui/Button.jsx';
import { ApiError } from '../api.js';
import { useServer } from '../context/ServerContext.jsx';

// '' (repo root) is shown as '/', 'apps/web' as '/apps/web'.
export function displayRootDir(rootDir) {
  return rootDir ? `/${rootDir}` : '/';
}

function Badge({ children }) {
  return (
    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--brand)]">
      {children}
    </span>
  );
}

// Folder browser for choosing a sub-folder of a repo on a given branch.
// Calls onSelect('apps/web') (or '' for the repo root) and closes itself via onClose.
export function RootDirModal({ open, onClose, repoFullName, branch, value, onSelect }) {
  const { api } = useServer();
  const [browsePath, setBrowsePath] = useState('');
  const [directories, setDirectories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // path -> directories, valid for one open session of the modal.
  const cache = useRef(new Map());

  // Each time the modal opens, start from the current selection with a fresh cache.
  useEffect(() => {
    if (!open) return;
    cache.current = new Map();
    setBrowsePath(value || '');
    // Only reset on open; `value` changing while closed is picked up by the next open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoFullName, branch]);

  useEffect(() => {
    if (!open || !repoFullName || !branch) return undefined;
    setError(null);
    const cached = cache.current.get(browsePath);
    if (cached) {
      setDirectories(cached);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setDirectories([]);
    const [owner, repo] = repoFullName.split('/');
    api.repos
      .tree(owner, repo, branch, browsePath)
      .then((data) => {
        if (cancelled) return;
        const list = data.directories ?? [];
        cache.current.set(browsePath, list);
        setDirectories(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? `The folder ${displayRootDir(browsePath)} does not exist on ${branch}. Go back up to pick another one.`
            : err.message || 'Failed to load folders'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, open, repoFullName, branch, browsePath]);

  const segments = browsePath ? browsePath.split('/') : [];
  const crumbs = [
    { label: '/', path: '' },
    ...segments.map((name, i) => ({ label: name, path: segments.slice(0, i + 1).join('/') })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Root directory"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(error) || loading}
            onClick={() => {
              onSelect(browsePath);
              onClose();
            }}
          >
            {browsePath ? <>Use <span className="font-mono">{displayRootDir(browsePath)}</span></> : 'Use / (repo root)'}
          </Button>
        </>
      }
    >
      <p className="text-xs text-[var(--text-muted)]">
        Browse {repoFullName} @ {branch} and pick the folder that contains the app.
      </p>

      <nav aria-label="Folder path" className="surface-inset flex flex-wrap items-center gap-1 rounded-2xl px-3 py-2 font-mono text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={crumb.path || 'root'} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : null}
              <button
                type="button"
                onClick={() => setBrowsePath(crumb.path)}
                disabled={last}
                className={[
                  'min-h-[32px] rounded-lg px-1.5 transition-colors',
                  last ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--brand)] hover:underline',
                ].join(' ')}
              >
                {crumb.label}
              </button>
            </span>
          );
        })}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
          Loading folders…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : directories.length === 0 ? (
        <div className="rounded-2xl border border-[var(--premium-border)] p-4 text-center text-sm text-[var(--text-muted)]">
          No sub-folders
        </div>
      ) : (
        <ul className="custom-scrollbar max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {directories.map((dir) => (
            <li key={dir.path}>
              <button
                type="button"
                onClick={() => setBrowsePath(dir.path)}
                className="surface-inset flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3.5 py-2 text-left transition-colors hover:border-[var(--brand)]"
              >
                <Folder className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--text-primary)]">{dir.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {dir.hasPackageJson ? <Badge>package.json</Badge> : null}
                  {dir.hasIndexHtml ? <Badge>index.html</Badge> : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// Read-only field showing the selected root directory with a Change button that opens the folder browser.
export function RootDirPicker({ repoFullName, branch, value = '', onChange }) {
  const [open, setOpen] = useState(false);
  const ready = Boolean(repoFullName && branch);

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Root directory</span>
      <div className="flex items-center gap-2">
        <div className="surface-inset flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-2xl px-3.5 sm:px-4">
          <Folder className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <span className="truncate font-mono text-sm text-[var(--text-primary)]">{displayRootDir(value)}</span>
        </div>
        <Button type="button" variant="ghost" disabled={!ready} onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>
      {!ready ? <p className="text-xs text-[var(--text-muted)]">Pick a repo and branch first.</p> : null}
      <RootDirModal
        open={open}
        onClose={() => setOpen(false)}
        repoFullName={repoFullName}
        branch={branch}
        value={value}
        onSelect={onChange}
      />
    </div>
  );
}
