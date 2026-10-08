import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Modal } from './ui/Modal.jsx';
import { Button } from './ui/Button.jsx';
import { BranchPicker } from './BranchPicker.jsx';
import { ApiError } from '../api.js';
import { useServer } from '../context/ServerContext.jsx';

const MODES = [
  { value: 'update', label: 'Update', description: 'Fetch the latest commit and reset in place. Fast — reuses the existing folder.' },
  { value: 'fresh', label: 'Fresh', description: 'Delete the app folder and re-clone from scratch, then run every step.' },
];

export function DeployDialog({ open, onClose, app }) {
  const navigate = useNavigate();
  const { api, serverPath } = useServer();
  const [branch, setBranch] = useState(app?.branch ?? '');
  const [mode, setMode] = useState('update');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setBranch(app?.branch ?? '');
      setMode('update');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app?.id]);

  if (!app) return null;

  const enabledSteps = app.steps?.filter((s) => s.enabled) ?? [];

  const handleDeploy = async () => {
    setLoading(true);
    setError(null);
    try {
      const { deployment } = await api.apps.deploy(app.id, { branch, mode });
      onClose();
      toast.success(`Deploy started for ${app.name}`);
      navigate(serverPath(`/deployments/${deployment.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start deployment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Deploy ${app.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleDeploy} loading={loading} disabled={!branch}>
            Deploy
          </Button>
        </>
      }
    >
      <BranchPicker repoFullName={app.repoFullName} value={branch} onChange={setBranch} />

      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Mode</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={[
                'rounded-2xl border p-3 text-left transition-colors',
                mode === m.value
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-[var(--premium-border)] hover:bg-black/[0.03] dark:hover:bg-white/5',
              ].join(' ')}
            >
              <p className="text-sm font-medium text-[var(--text-primary)]">{m.label}</p>
              <p className="text-xs text-[var(--text-muted)]">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      {enabledSteps.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Steps that will run</span>
            <Link to={serverPath(`/apps/${app.id}?tab=steps`)} onClick={onClose} className="text-xs font-medium text-[var(--brand)] hover:underline">
              Edit steps
            </Link>
          </div>
          <ol className="space-y-1 text-sm text-[var(--text-secondary)]">
            {enabledSteps.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-[var(--text-muted)]">{i + 1}.</span>
                {s.config?.label || s.type}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
    </Modal>
  );
}
