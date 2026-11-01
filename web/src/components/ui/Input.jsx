import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

const FIELD_BASE =
  'field-base w-full min-h-[44px] rounded-2xl py-2.5 sm:py-3 shadow-xs outline-none ' +
  'text-[var(--text-primary)]';

export function Input({ label, hint, icon: Icon, error, className = '', id, ...rest }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const isPassword = rest.type === 'password';
  const [revealed, setRevealed] = useState(false);

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
          className={[FIELD_BASE, Icon ? 'pl-11' : 'pl-3.5 sm:pl-4', isPassword ? 'pr-11' : 'pr-3.5 sm:pr-4', error ? 'ring-2 ring-rose-500/50' : '', className]
            .filter(Boolean)
            .join(' ')}
          {...rest}
          type={isPassword && revealed ? 'text' : rest.type}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {hint && !error ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
    </div>
  );
}
