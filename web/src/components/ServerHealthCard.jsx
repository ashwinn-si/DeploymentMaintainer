import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server } from 'lucide-react';
import { GlassCard } from './ui/GlassCard.jsx';
import { Meter } from './ui/Meter.jsx';
import { systemApi } from '../api.js';

// Compact summary card for the Apps home page. Stage 7 builds out the full
// /server page (rings, sparklines, per-app table); this stays intentionally
// small and silently renders nothing if the endpoint isn't available yet.
export function ServerHealthCard() {
  const [system, setSystem] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    systemApi
      .get()
      .then((data) => !cancelled && setSystem(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !system) return null;

  const { current, disks } = system;
  const disk = disks?.[0];
  const diskPct = disk ? (disk.used / disk.total) * 100 : 0;
  const memPct = (current.memUsed / current.memTotal) * 100;

  return (
    <Link to="/server" className="block">
      <GlassCard variant="mid" interactive>
        <div className="mb-4 flex items-center gap-2">
          <Server className="h-4 w-4 text-[var(--brand)]" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Server</h2>
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
