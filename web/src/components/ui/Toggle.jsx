export function Toggle({ checked, onChange, label, disabled = false, className = '' }) {
  return (
    <label className={['inline-flex items-center gap-3 select-none', disabled ? 'opacity-50' : 'cursor-pointer', className].join(' ')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={[
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50',
          checked ? 'bg-[var(--brand)]' : 'bg-black/10 dark:bg-white/10',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-6' : 'translate-x-1',
          ].join(' ')}
        />
      </button>
      {label ? <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span> : null}
    </label>
  );
}
