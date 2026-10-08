export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div
      role="tablist"
      className={['surface-inset inline-flex items-center gap-1 rounded-full p-1', className].join(' ')}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(tab.value)}
            className={[
              'min-h-[38px] rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--premium-ring)]',
              active ? 'bg-[var(--brand)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
