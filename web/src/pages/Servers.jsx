import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layers, Plus, MoreVertical, Pencil, Link2, KeyRound, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Meter } from '../components/ui/Meter.jsx';
import { Loader } from '../components/ui/Loader.jsx';
import { StatusPill } from '../components/ui/StatusPill.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { AddServerDialog } from '../components/AddServerDialog.jsx';
import { useServers } from '../context/ServersContext.jsx';
import { serverApi, serversApi, ApiError } from '../api.js';
import { formatRelativeTime } from '../lib/format.js';

const POLL_MS = 15000;
const SUMMARY_POLL_MS = 30000;

const STATUS = {
  online: { tone: 'teal', label: 'online' },
  offline: { tone: 'rose', label: 'offline' },
  unauthorized: { tone: 'amber', label: 'secret rejected' },
};

function useSummary(server) {
  const [summary, setSummary] = useState(null);
  const online = server.status === 'online';

  useEffect(() => {
    if (!online) {
      setSummary(null);
      return undefined;
    }
    const api = serverApi(server.id);
    let cancelled = false;
    async function load() {
      const [apps, active, system] = await Promise.allSettled([api.apps.list(), api.deployments.active(), api.system.get()]);
      if (cancelled) return;
      setSummary({
        apps: apps.status === 'fulfilled' ? apps.value.apps?.length ?? null : null,
        active: active.status === 'fulfilled' ? active.value.deployments?.length ?? null : null,
        system: system.status === 'fulfilled' ? system.value : null,
      });
    }
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, SUMMARY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [server.id, online]);

  return summary;
}

function KebabMenu({ server, onAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = [
    { key: 'rename', label: 'Rename', icon: Pencil },
    { key: 'url', label: 'Edit URL', icon: Link2 },
    { key: 'rotate', label: 'Rotate secret', icon: KeyRound },
    { key: 'remove', label: 'Remove', icon: Trash2, danger: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${server.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--text-primary)] active:scale-95 dark:hover:bg-white/10"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="glass-strong absolute right-0 top-full z-30 mt-1 w-48 space-y-0.5 rounded-2xl border border-white/60 p-1.5 shadow-lg dark:border-white/10"
        >
          {items.map(({ key, label, icon: Icon, danger }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAction(key, server);
              }}
              className={[
                'flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                danger
                  ? 'text-rose-500 hover:bg-rose-500/10'
                  : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function ServerCard({ server, onAction }) {
  const summary = useSummary(server);
  const status = STATUS[server.status] ?? STATUS.offline;
  const system = summary?.system;
  const disk = system?.disks?.[0];

  return (
    <GlassCard variant="mid" interactive className="relative flex flex-col gap-4">
      <Link to={`/s/${server.id}`} className="absolute inset-0 rounded-3xl" aria-label={`Open ${server.name}`} />

      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{server.name}</h3>
          <p className="truncate font-mono text-xs text-[var(--text-muted)]">{server.url}</p>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          <KebabMenu server={server} onAction={onAction} />
        </div>
      </div>

      <div className="pointer-events-none relative z-10 grid grid-cols-3 gap-3">
        <Stat label="Version" value={server.version ? `v${server.version}` : '—'} />
        <Stat label="Host" value={server.hostname ?? '—'} />
        <Stat label="Last seen" value={formatRelativeTime(server.lastSeenAt)} />
      </div>

      {server.status === 'online' && summary ? (
        <div className="pointer-events-none relative z-10 space-y-3 border-t border-black/[0.06] pt-4 dark:border-white/10">
          <p className="text-xs text-[var(--text-muted)]">
            {summary.apps ?? '—'} app{summary.apps === 1 ? '' : 's'}
            {summary.active ? <span className="text-[var(--brand)]"> · {summary.active} deploying</span> : null}
          </p>
          {system?.current ? (
            <div className="grid grid-cols-3 gap-3">
              <Meter label="CPU" value={system.current.cpuPct} />
              <Meter label="RAM" value={system.current.memTotal ? (system.current.memUsed / system.current.memTotal) * 100 : 0} />
              <Meter label="Disk" value={disk?.total ? (disk.used / disk.total) * 100 : 0} />
            </div>
          ) : null}
        </div>
      ) : server.status === 'unauthorized' ? (
        <p className="pointer-events-none relative z-10 text-xs text-amber-700 dark:text-amber-400">
          The server rejected the stored secret. Rotate it from the menu.
        </p>
      ) : server.status === 'offline' ? (
        <p className="pointer-events-none relative z-10 text-xs text-[var(--text-muted)]">Can't reach this server right now.</p>
      ) : null}
    </GlassCard>
  );
}

function EditServerDialog({ field, server, onClose, onSaved }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const open = Boolean(server);
  const isName = field === 'name';

  // Reset only when a (different) dialog opens; callbacks aren't dependencies.
  useEffect(() => {
    if (server) {
      setValue(isName ? server.name : server.url);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, field]);

  const trimmed = value.trim();
  const valid = isName ? trimmed.length > 0 && trimmed.length <= 60 : /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/i.test(trimmed);

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await serversApi.update(server.id, isName ? { name: trimmed } : { url: trimmed });
      toast.success(isName ? 'Server renamed' : 'URL updated');
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isName ? 'Rename server' : 'Edit server URL'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!valid}>
            {error ? 'Retry' : 'Save'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Input
          label={isName ? 'Name' : 'URL'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={isName ? 60 : undefined}
          autoComplete="off"
          hint={isName ? undefined : 'The new address is verified with the stored secret before it is saved.'}
          error={!isName && trimmed && !valid ? 'Must start with https:// (or http://localhost for local testing)' : undefined}
        />
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      </form>
    </Modal>
  );
}

export function Servers() {
  const navigate = useNavigate();
  const { servers, error, refresh } = useServers();
  const [addOpen, setAddOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState(null);
  const [edit, setEdit] = useState({ field: 'name', server: null });
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeNonce = useRef(0);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const handleAction = useCallback((action, server) => {
    if (action === 'rename') setEdit({ field: 'name', server });
    else if (action === 'url') setEdit({ field: 'url', server });
    else if (action === 'rotate') setRotateTarget(server);
    else if (action === 'remove') {
      removeNonce.current += 1;
      setRemoveTarget(server);
      setRemoveOpen(true);
    }
  }, []);

  const handleAdded = async (server) => {
    await refresh();
    navigate(`/s/${server.id}`);
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await serversApi.remove(removeTarget.id);
      toast.success(`${removeTarget.name} removed`);
      setRemoveOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove server');
    } finally {
      setRemoving(false);
    }
  };

  const addButton = (
    <Button size="md" onClick={() => setAddOpen(true)}>
      <Plus className="h-4 w-4" />
      Add Server
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader icon={Layers} eyebrow="Dashboard" title="Servers" actions={addButton}>
        Every server you manage from this dashboard.
      </PageHeader>

      {servers === null ? (
        error ? (
          <EmptyState
            icon={Layers}
            title="Couldn't load servers"
            description={error.message}
            action={<Button onClick={refresh}>Retry</Button>}
          />
        ) : (
          <Loader label="Loading servers…" />
        )
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No servers yet"
          description="Add a server: name it, paste the generated SERVER_ID and SERVER_SECRET into its .env, reload it, and the dashboard verifies the connection."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Server
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} onAction={handleAction} />
          ))}
        </div>
      )}

      <AddServerDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={handleAdded} />
      <AddServerDialog
        open={Boolean(rotateTarget)}
        mode="rotate"
        server={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onDone={refresh}
      />
      <EditServerDialog field={edit.field} server={edit.server} onClose={() => setEdit((e) => ({ ...e, server: null }))} onSaved={refresh} />
      <ConfirmDialog
        key={removeNonce.current}
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={handleRemove}
        loading={removing}
        title="Remove server?"
        description="This only removes it from the dashboard. Nothing is changed on the server itself — its apps keep running."
        confirmLabel="Remove"
        confirmText={removeTarget?.name}
      />
    </div>
  );
}
