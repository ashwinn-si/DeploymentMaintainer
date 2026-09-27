import { useEffect, useState } from 'react';
import { Input } from './ui/Input.jsx';
import { nodeApi, reposApi } from '../api.js';

export function NodeVersionPicker({ repoFullName, branch, value, onChange }) {
  const [installed, setInstalled] = useState([]);
  const [detected, setDetected] = useState(null);

  useEffect(() => {
    nodeApi
      .versions()
      .then((data) => {
        setInstalled(data.installed ?? []);
        if (!value && data.default) onChange(data.default);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!repoFullName) {
      setDetected(null);
      return undefined;
    }
    let cancelled = false;
    const [owner, repo] = repoFullName.split('/');
    reposApi
      .nodeVersion(owner, repo, branch)
      .then((data) => {
        if (cancelled) return;
        setDetected(data);
        if (data.version && !value) onChange(data.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, branch]);

  return (
    <div className="space-y-2">
      <Input label="Node version" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="20.11.1" className="font-mono" />
      {detected?.version ? (
        <p className="text-xs text-[var(--text-muted)]">
          Detected <span className="font-mono">{detected.version}</span> from {detected.source}
        </p>
      ) : null}
      {installed.length ? (
        <div className="flex flex-wrap gap-1.5">
          {installed.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={[
                'min-h-[38px] rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                value === v ? 'bg-[var(--brand)] text-white' : 'glass-light text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              {v}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
