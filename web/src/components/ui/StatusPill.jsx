const TONES = {
  brand: 'bg-[var(--brand)]/10 border-[var(--brand)]/20 text-[var(--brand)]',
  teal: 'bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400',
  amber: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
  rose: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
  neutral: 'bg-black/5 border-black/5 text-[var(--text-muted)] dark:bg-white/5 dark:border-white/10',
};

const DOT_TONES = {
  brand: 'bg-[var(--brand)]',
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  neutral: 'bg-[var(--text-muted)]',
};

export function statusTone(status) {
  const s = (status || '').toLowerCase();
  if (['deploying', 'running', 'queued'].includes(s)) return { tone: 'brand', pulse: true };
  if (['online', 'success', 'healthy'].includes(s)) return { tone: 'teal', pulse: false };
  if (['stopped', 'cancelled'].includes(s)) return { tone: 'amber', pulse: false };
  if (['failed', 'errored', 'unhealthy'].includes(s)) return { tone: 'rose', pulse: false };
  return { tone: 'neutral', pulse: false };
}

export function StatusPill({ tone = 'neutral', pulse = false, children, className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
        TONES[tone] ?? TONES.neutral,
        className,
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 rounded-full', DOT_TONES[tone] ?? DOT_TONES.neutral, pulse ? 'animate-pulse' : ''].join(' ')} />
      {children}
    </span>
  );
}
