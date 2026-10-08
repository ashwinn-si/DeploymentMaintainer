import { useId } from 'react';

const FIELD_BASE =
  'field-base w-full min-h-[44px] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-xs outline-none ' +
  'text-[var(--text-primary)] font-mono text-sm';

export function Textarea({ label, hint, error, className = '', id, rows = 4, ...rest }) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </label>
      ) : null}
      <textarea
        id={inputId}
        rows={rows}
        className={[FIELD_BASE, error ? 'ring-2 ring-rose-500/50' : '', className].filter(Boolean).join(' ')}
        {...rest}
      />
      {hint && !error ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
    </div>
  );
}
