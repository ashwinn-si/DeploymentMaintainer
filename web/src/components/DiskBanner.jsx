import { AlertTriangle } from 'lucide-react';
import { useOptionalServer } from '../context/ServerContext.jsx';
import { useSystemStats } from '../hooks/useSystemStats.js';

const THRESHOLD_PCT = 90;

export function DiskBanner() {
  const ctx = useOptionalServer();
  const { system } = useSystemStats(ctx?.server.id);
  const disks = system?.disks ?? [];
  const full = disks.filter((d) => d.total > 0 && (d.used / d.total) * 100 > THRESHOLD_PCT);

  if (!ctx || full.length === 0) return null;

  return (
    <div className="surface-inset flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
      <p className="text-sm text-rose-600 dark:text-rose-400">
        {full.map((d) => `${d.mount} is ${Math.round((d.used / d.total) * 100)}% full`).join(' · ')} — deploys may fail. Free up space
        or grow the volume soon.
      </p>
    </div>
  );
}
