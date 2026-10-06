import { useEffect, useState } from 'react';
import { Plug, Check, AlertCircle } from 'lucide-react';
import { Modal } from './ui/Modal.jsx';
import { StatusPill } from './ui/StatusPill.jsx';
import { Button } from './ui/Button.jsx';
import { Loader } from './ui/Loader.jsx';
import { useServer } from '../context/ServerContext.jsx';

const COMMON_PORTS = [3000, 3001, 3002, 3003, 3004, 3005, 4000, 4001, 5000, 5001, 8000, 8080, 8888, 9000];

export function OccupiedPortsModal({ open, onClose, onSelectPort, currentPort }) {
  const { api } = useServer();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.ports
      .list()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch ports');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, api]);

  // /ports returns { dashboard: { port }, rows }; the dashboard's own port is occupied too.
  const occupiedPorts = [
    ...(data?.dashboard?.port ? [{ port: data.dashboard.port, appName: 'Deployment Maintainer', conflict: null }] : []),
    ...(data?.rows ?? []),
  ];
  const occupiedNumbers = new Set(occupiedPorts.map((p) => Number(p.port)));
  const suggestedAvailable = COMMON_PORTS.filter((p) => !occupiedNumbers.has(p)).slice(0, 8);

  return (
    <Modal open={open} onClose={onClose} title="Port Allocation" size="lg">
      <div className="space-y-5">
        <p className="text-xs text-[var(--text-muted)]">
          Below are all ports currently bound or routed on this server. Select an available port to automatically fill it in your configuration.
        </p>

        {loading ? (
          <Loader label="Loading occupied ports…" />
        ) : error ? (
          <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-500 border border-rose-500/20">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            {/* Suggested Available Ports */}
            {suggestedAvailable.length > 0 ? (
              <div className="space-y-2 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-3.5 dark:bg-teal-500/5">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                  Recommended Available Ports
                </span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {suggestedAvailable.map((p) => {
                    const selected = String(currentPort) === String(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          onSelectPort?.(p);
                          onClose?.();
                        }}
                        className={[
                          'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-semibold transition-all',
                          selected
                            ? 'bg-teal-600 text-white dark:text-[#0B0D11] shadow-sm'
                            : 'glass-light text-teal-700 dark:text-teal-400 border border-teal-500/30 hover:bg-teal-500/20',
                        ].join(' ')}
                      >
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                        Port {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Occupied Ports Table / List */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Occupied Ports ({occupiedPorts.length})
              </span>

              {occupiedPorts.length === 0 ? (
                <div className="rounded-2xl border border-black/[0.06] dark:border-white/10 p-4 text-center text-sm text-[var(--text-muted)]">
                  No ports currently occupied.
                </div>
              ) : (
                <div className="custom-scrollbar max-h-64 space-y-2 overflow-y-auto pr-1">
                  {occupiedPorts.map((row) => {
                    const isCurrent = String(currentPort) === String(row.port);
                    return (
                      <div
                        key={row.port}
                        className={[
                          'flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm transition-colors',
                          row.conflict
                            ? 'border-rose-500/30 bg-rose-500/10'
                            : isCurrent
                            ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                            : 'border-white/60 bg-white/40 dark:border-white/10 dark:bg-black/20',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-xl bg-black/5 dark:bg-white/10 font-mono font-bold text-[var(--text-primary)]">
                            {row.port}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-[var(--text-primary)]">{row.appName}</span>
                              {row.conflict ? <StatusPill tone="rose">conflict</StatusPill> : null}
                            </div>
                            <p className="truncate text-xs text-[var(--text-muted)]">
                              {row.repoFullName} @ {row.branch} {row.path ? `· ${row.path}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill tone={row.health?.ok ? 'teal' : row.pm2Status === 'online' ? 'brand' : 'amber'}>
                            {row.pm2Status || 'occupied'}
                          </StatusPill>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              onSelectPort?.(row.port);
                              onClose?.();
                            }}
                          >
                            Use {row.port}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
