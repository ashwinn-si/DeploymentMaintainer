import { Link } from 'react-router-dom';
import { Server } from 'lucide-react';
import { GlassCard } from './ui/GlassCard.jsx';
import { Meter } from './ui/Meter.jsx';
import { useSystemStats } from '../hooks/useSystemStats.js';
import { formatUptime } from '../lib/format.js';

// Compact summary card for the Apps home page, sharing the same polled
// /system data as the Server page and the disk banner. Renders nothing if
// the endpoint isn't available (or hasn't resolved yet).
export function ServerHealthCard() {
  const { system } = useSystemStats();

  if (!system) return null;

  const { current, disks, info } = system;
  const disk = disks?.[0];
  const diskPct = disk ? (disk.used / disk.total) * 100 : 0;
  const memPct = (current.memUsed / current.memTotal) * 100;

  return (
    <Link to="/server" className="block">
      <GlassCard variant="mid" interactive>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Server</h2>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            load {current.load1?.toFixed(2)} · up {formatUptime(info?.uptimeSec)}
          </span>
        </div>
        <div className="space-y-3">
          <Meter label="CPU" value={current.cpuPct} />
          <Meter label="RAM" value={memPct} />
          <Meter label="Disk" value={diskPct} />
        </div>
      </GlassCard>
    </Link>
  );
}
