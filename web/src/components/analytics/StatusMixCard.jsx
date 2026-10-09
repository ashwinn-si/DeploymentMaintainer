import { ChartCard, STATUS_META, formatCount, formatPercent } from './chartTheme.jsx';

export function StatusMixCard({ status }) {
  const total = STATUS_META.reduce((sum, s) => sum + status[s.key], 0);

  return (
    <ChartCard title="Status mix" hint="HTTP response classes. Bots and 404s are included.">
      <div
        className="flex h-6 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
        role="img"
        aria-label={STATUS_META.map((s) => `${s.label}: ${formatPercent(status[s.key], total)}`).join(', ')}
      >
        {STATUS_META.map((s) =>
          status[s.key] > 0 ? (
            <div
              key={s.key}
              title={`${s.label}: ${formatCount(status[s.key])}`}
              style={{ width: `${(status[s.key] / total) * 100}%`, background: s.color }}
            />
          ) : null
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STATUS_META.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{s.label}</span>
            <span className="font-mono font-semibold text-[var(--text-primary)]">{formatCount(status[s.key])}</span>
            <span className="w-12 text-right text-xs text-[var(--text-muted)]">{formatPercent(status[s.key], total)}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
