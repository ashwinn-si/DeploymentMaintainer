import { useId } from 'react';

const FIELD_BASE =
  'w-full min-h-[44px] bg-white/80 dark:bg-black/25 border border-black/[0.08] dark:border-white/10 ' +
  'rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-xs transition-all outline-none ' +
  'focus:bg-white dark:focus:bg-black/40 focus:ring-3 focus:ring-[var(--brand)]/30 ' +
  'placeholder:text-[var(--text-muted)]/50 text-[var(--text-primary)]';

export function Input({ label, hint, icon: Icon, error, className = '', id, ...rest }) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {Icon ? (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        ) : null}
        <input
          id={inputId}
          className={[FIELD_BASE, Icon ? 'pl-10' : '', error ? 'ring-2 ring-rose-500/50' : '', className]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
      </div>
      {hint && !error ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
    </div>
  );
}
