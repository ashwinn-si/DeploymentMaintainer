import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { SelectSheet } from '../ui/SelectSheet.jsx';

export const RANGE_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

function Box({ checked }) {
  return (
    <span
      className={[
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
        checked ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--premium-border)] bg-transparent',
      ].join(' ')}
    >
      {checked ? <Check className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

function CheckRow({ checked, onClick, children }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <Box checked={checked} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

// `selected` is an array of app ids; empty means every app.
function AppsMultiSelect({ apps, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0 || selected.length === apps.length;
  const label = allSelected ? 'All apps' : `${selected.length} app${selected.length === 1 ? '' : 's'}`;

  function toggle(id) {
    // From "All apps", ticking one app narrows to just that app.
    if (allSelected) return onChange([id]);
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    // Everything (or nothing) ticked collapses back to "All apps".
    return onChange(next.length === apps.length || next.length === 0 ? [] : next);
  }

  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Apps</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between rounded-2xl field-base ui-transition hover:bg-base-300 px-4 py-2.5 text-sm text-[var(--text-primary)] shadow-xs"
      >
        <span>{label}</span>
        <span className="select-caret" aria-hidden="true" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Apps"
        size="sm"
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <div className="custom-scrollbar max-h-72 space-y-1 overflow-y-auto">
          <CheckRow checked={allSelected} onClick={() => onChange([])}>
            <span className="font-medium text-[var(--text-primary)]">All apps</span>
          </CheckRow>
          {apps.map((app) => (
            <CheckRow key={app.id} checked={allSelected || selected.includes(app.id)} onClick={() => toggle(app.id)}>
              {app.name}
            </CheckRow>
          ))}
          {apps.length === 0 ? <p className="px-3.5 py-2.5 text-sm text-[var(--text-muted)]">No apps yet</p> : null}
        </div>
      </Modal>
    </div>
  );
}

export function AnalyticsControls({ range, onRangeChange, apps, selected, onSelectedChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:max-w-md sm:grid-cols-2">
      <SelectSheet label="Time range" value={range} onChange={onRangeChange} options={RANGE_OPTIONS} />
      <AppsMultiSelect apps={apps} selected={selected} onChange={onSelectedChange} />
    </div>
  );
}
