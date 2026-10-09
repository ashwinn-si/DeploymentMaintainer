import { formatCount, formatPercent } from './chartTheme.jsx';
import { GlassCard } from '../ui/GlassCard.jsx';

function Tile({ label, value, sub, tone }) {
  return (
    <GlassCard variant="mid" className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`truncate text-2xl font-bold tracking-tight sm:text-3xl ${tone ?? 'text-[var(--text-primary)]'}`}>{value}</p>
      <p className="truncate text-xs text-[var(--text-muted)]">{sub}</p>
    </GlassCard>
  );
}

export function SummaryTiles({ data }) {
  const total = data.apps.reduce((sum, a) => sum + a.total, 0);
  const top = data.apps[0];
  const errors = data.status.s4xx + data.status.s5xx;
  const statusTotal = data.status.s2xx + data.status.s3xx + errors;
  const errorShare = statusTotal ? errors / statusTotal : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Tile label="Total requests" value={formatCount(total)} sub={`across ${data.apps.length} app${data.apps.length === 1 ? '' : 's'}`} />
      <Tile
        label="Busiest app"
        value={top && top.total > 0 ? top.name : '—'}
        sub={top && top.total > 0 ? `${formatCount(top.total)} requests · ${formatPercent(top.total, total)} of traffic` : 'No traffic yet'}
      />
      <Tile
        label="Error rate"
        value={formatPercent(errors, statusTotal)}
        sub={`${formatCount(errors)} of ${formatCount(statusTotal)} were 4xx or 5xx`}
        tone={errorShare >= 0.1 ? 'text-rose-500' : errorShare >= 0.02 ? 'text-amber-500' : undefined}
      />
    </div>
  );
}
