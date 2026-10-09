import { GlassCard } from '../ui/GlassCard.jsx';

// Shared bits for the Analytics charts. Colours are CSS variable strings so they follow the
// light/dark theme without re-rendering; Recharts passes them through as SVG attributes.

export const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 };
export const GRID_STROKE = 'var(--premium-border)';
export const BRAND = 'var(--brand)';
export const MUTED_BAR = 'var(--text-muted)';

// One colour per app, cycled when there are more apps than colours.
const APP_COLORS = [
  'var(--brand)',
  'var(--data-teal)',
  'var(--data-blue)',
  'var(--data-purple)',
  'var(--data-amber)',
  'var(--data-pink)',
];

export function appColor(index) {
  return APP_COLORS[index % APP_COLORS.length];
}

export const STATUS_META = [
  { key: 's2xx', label: '2xx Success', color: 'var(--data-teal)' },
  { key: 's3xx', label: '3xx Redirect', color: 'var(--data-blue)' },
  { key: 's4xx', label: '4xx Client error', color: 'var(--data-amber)' },
  { key: 's5xx', label: '5xx Server error', color: '#f43f5e' },
];

const numberFormat = new Intl.NumberFormat();

export function formatCount(n) {
  return numberFormat.format(n ?? 0);
}

export function formatPercent(part, whole) {
  if (!whole) return '0%';
  const pct = (part / whole) * 100;
  return `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
}

// Hourly buckets read in the viewer's local time; day buckets are UTC days, so they are
// labelled in UTC (a local label could show the neighbouring date).
export function formatBucket(iso, bucket, long = false) {
  const d = new Date(iso);
  if (bucket === 'day') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return long ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}` : time;
}

// Floating tooltip card; `rows` is [{ label, value, color }].
export function TooltipCard({ title, rows }) {
  return (
    <div className="surface-overlay rounded-xl px-3 py-2 text-xs shadow-lg">
      {title ? <p className="mb-1 font-semibold text-[var(--text-primary)]">{title}</p> : null}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-[var(--text-secondary)]">
            {row.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} /> : null}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="font-mono font-semibold text-[var(--text-primary)]">{formatCount(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartCard({ title, hint, className = '', children }) {
  return (
    <GlassCard variant="mid" className={`space-y-4 ${className}`}>
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      </div>
      {children}
    </GlassCard>
  );
}
