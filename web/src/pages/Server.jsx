import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server as ServerIcon, ArrowDown, ArrowUp, HardDrive } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Ring, Meter } from '../components/ui/Meter.jsx';
import { Sparkline } from '../components/ui/Sparkline.jsx';
import { StatusPill } from '../components/ui/StatusPill.jsx';
import { useSystemStats } from '../hooks/useSystemStats.js';
import { formatBytes, formatUptime, formatUptimeMs } from '../lib/format.js';

const SORT_OPTIONS = [
  { key: 'memory', label: 'Memory' },
  { key: 'diskBytes', label: 'Folder size' },
];

const COLS = 'sm:grid-cols-[1.3fr_90px_70px_100px_80px_90px_100px_100px]';

function InfoChip({ label, value }) {
  return (
    <div className="glass-light rounded-2xl border border-white/60 px-4 py-2.5 dark:border-white/10">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function RingCard({ label, value, sublabel, data, color }) {
  return (
    <GlassCard variant="mid" className="flex flex-col items-center gap-3 text-center">
      <Ring value={value} size={140} stroke={10} label={label} sublabel={sublabel} />
      <Sparkline data={data} width={160} height={36} color={color} />
    </GlassCard>
  );
}

function AppDesktopRow({ app }) {
  return (
    <Link
      to={`/apps/${app.appId}`}
      className={`hidden sm:grid ${COLS} items-center gap-3 border-b border-black/[0.06] px-5 py-3 text-sm transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/5`}
    >
      <span className="truncate font-medium text-[var(--text-primary)]">{app.appName}</span>
      <span className="text-[var(--text-muted)]">{app.pm2Status ?? '—'}</span>
      <span className="text-[var(--text-muted)]">{app.cpu !== null && app.cpu !== undefined ? `${app.cpu}%` : '—'}</span>
      <span className="text-[var(--text-muted)]">{formatBytes(app.memory)}</span>
      <span className="text-[var(--text-muted)]">{app.restarts ?? '—'}</span>
      <span className="text-[var(--text-muted)]">{formatUptimeMs(app.uptimeMs)}</span>
      <span className="text-[var(--text-muted)]">{formatBytes(app.diskBytes)}</span>
      <StatusPill tone={app.health?.ok ? 'teal' : 'rose'}>{app.health?.ok ? 'healthy' : 'unhealthy'}</StatusPill>
    </Link>
  );
}

function AppMobileCard({ app }) {
  return (
    <Link to={`/apps/${app.appId}`} className="glass-light block space-y-2 rounded-2xl border border-white/60 p-4 dark:border-white/10 sm:hidden">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--text-primary)]">{app.appName}</p>
        <StatusPill tone={app.health?.ok ? 'teal' : 'rose'}>{app.health?.ok ? 'healthy' : 'unhealthy'}</StatusPill>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>PM2: {app.pm2Status ?? '—'}</span>
        <span>CPU: {app.cpu !== null && app.cpu !== undefined ? `${app.cpu}%` : '—'}</span>
        <span>Memory: {formatBytes(app.memory)}</span>
        <span>Restarts: {app.restarts ?? '—'}</span>
        <span>Uptime: {formatUptimeMs(app.uptimeMs)}</span>
        <span>Disk: {formatBytes(app.diskBytes)}</span>
      </div>
    </Link>
  );
}

export function Server() {
  const { system } = useSystemStats();
  const [sortKey, setSortKey] = useState('memory');
  const [sortDir, setSortDir] = useState('desc');

  const apps = useMemo(() => {
    const list = system?.apps ?? [];
    const sorted = [...list].sort((a, b) => (a[sortKey] ?? 0) - (b[sortKey] ?? 0));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [system, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={ServerIcon} eyebrow="Health" title="Server">
        CPU, RAM, disk and per-app resource usage.
      </PageHeader>

      {!system ? (
        <EmptyState icon={ServerIcon} title="Server stats unavailable" description="Couldn't reach /system. Try refreshing the page." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <InfoChip label="Hostname" value={system.info.hostname} />
            <InfoChip label="Platform" value={system.info.platform} />
            <InfoChip label="Uptime" value={formatUptime(system.info.uptimeSec)} />
            <InfoChip label="CPUs" value={system.info.cpuCount} />
            <InfoChip label="Node / PM2" value={`${system.info.nodeVersion} / ${system.info.pm2Version}`} />
            <InfoChip label="Nginx" value={system.info.nginxVersion ?? 'disabled'} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <RingCard
              label="CPU"
              value={system.current.cpuPct}
              sublabel={`load ${system.current.load1?.toFixed(2)} / ${system.current.load5?.toFixed(2)} / ${system.current.load15?.toFixed(2)}`}
              data={system.history.map((h) => h.cpuPct)}
              color="var(--data-blue)"
            />
            <RingCard
              label="RAM"
              value={(system.current.memUsed / system.current.memTotal) * 100}
              sublabel={`swap ${formatBytes(system.current.swapUsed)} / ${formatBytes(system.current.swapTotal)}`}
              data={system.history.map((h) => (h.memUsed / h.memTotal) * 100)}
              color="var(--data-purple)"
            />
            <RingCard
              label="Disk"
              value={system.current.diskUsedPct}
              sublabel={system.disks?.[0] ? `${formatBytes(system.disks[0].used)} / ${formatBytes(system.disks[0].total)}` : undefined}
              data={system.history.map((h) => h.diskUsedPct)}
              color="var(--data-teal)"
            />
          </div>

          <GlassCard variant="mid">
            <div className="mb-4 flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Disks</h2>
            </div>
            <div className="space-y-4">
              {system.disks.map((d) => (
                <div key={d.mount}>
                  <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span className="font-mono">{d.mount}</span>
                    <span>
                      {formatBytes(d.used)} used · {formatBytes(d.free)} free of {formatBytes(d.total)}
                    </span>
                  </div>
                  <Meter value={(d.used / d.total) * 100} />
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard variant="mid" className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-5 py-3 dark:border-white/10">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Apps</h2>
              <div className="hidden items-center justify-end gap-2 sm:flex">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleSort(opt.key)}
                    className="flex min-h-[38px] items-center gap-1 rounded-lg px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Sort by {opt.label}
                    {sortKey === opt.key ? sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" /> : null}
                  </button>
                ))}
              </div>
            </div>

            {apps.length === 0 ? (
              <p className="p-5 text-sm text-[var(--text-muted)]">No apps yet.</p>
            ) : (
              <div className="space-y-3 p-3 sm:space-y-0 sm:p-0">
                {apps.map((app) => (
                  <div key={app.appId}>
                    <AppDesktopRow app={app} />
                    <AppMobileCard app={app} />
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
