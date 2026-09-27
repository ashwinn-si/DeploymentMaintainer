import { useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { Input } from './Input.jsx';

export function SelectSheet({ label, value, onChange, options, placeholder = 'Select…', searchable = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = searchable && query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;

  return (
    <div className="space-y-1.5">
      {label ? (
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-white/60 bg-white/60 px-4 py-2.5 text-sm text-[var(--text-primary)] shadow-xs transition-colors hover:bg-white/80 dark:border-white/10 dark:bg-black/40 dark:hover:bg-black/60"
      >
        <span className={selected ? '' : 'text-[var(--text-muted)]'}>{selected ? selected.label : placeholder}</span>
        <span className="select-caret" aria-hidden="true" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={label || 'Select'} size="sm">
        {searchable ? (
          <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} icon={Search} autoFocus />
        ) : null}
        <div className="custom-scrollbar max-h-72 space-y-1 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange?.(opt.value);
                setOpen(false);
                setQuery('');
              }}
              className={[
                'w-full rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors',
                opt.value === value
                  ? 'bg-[var(--brand-soft)] font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
          {filtered.length === 0 ? <p className="px-3.5 py-2.5 text-sm text-[var(--text-muted)]">No matches</p> : null}
        </div>
      </Modal>
    </div>
  );
}
