import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Eye, EyeOff, ClipboardPaste, ClipboardCopy, Search } from 'lucide-react';
import { Input } from './ui/Input.jsx';
import { Button } from './ui/Button.jsx';
import { Modal } from './ui/Modal.jsx';
import { Textarea } from './ui/Textarea.jsx';

export function parseDotEnv(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    const inlineComment = value.match(/^([^"'].*?)\s+#.*$/);
    if (inlineComment && !value.startsWith('"') && !value.startsWith("'")) value = inlineComment[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value });
  }
  return rows;
}

// Inverse of parseDotEnv: quote only values it would otherwise mangle (spaces, #, quotes).
export function toDotEnv(rows) {
  return rows
    .filter((r) => r.key)
    .map(({ key, value }) => {
      if (!/[\s#'"]/.test(value)) return `${key}=${value}`;
      return value.includes('"') && !value.includes("'") ? `${key}='${value}'` : `${key}="${value}"`;
    })
    .join('\n');
}

export function EnvEditor({ value = [], onChange }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [query, setQuery] = useState('');

  const keyCounts = value.reduce((acc, row) => {
    if (row.key) acc[row.key] = (acc[row.key] ?? 0) + 1;
    return acc;
  }, {});

  const needle = query.trim().toLowerCase();
  const visibleCount = value.filter((row) => !row.key || row.key.toLowerCase().includes(needle)).length;

  const updateRow = (idx, patch) => onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeRow = (idx) => onChange(value.filter((_, i) => i !== idx));
  const addRow = () => {
    setQuery('');
    onChange([...value, { key: '', value: '' }]);
  };
  const toggleReveal = (idx) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(toDotEnv(value));
      toast.success('Copied .env to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const applyPaste = () => {
    const parsed = parseDotEnv(pasteText);
    if (parsed.length > 0) {
      const merged = [...value];
      for (const row of parsed) {
        const existingIdx = merged.findIndex((r) => r.key === row.key);
        if (existingIdx >= 0) merged[existingIdx] = row;
        else merged.push(row);
      }
      onChange(merged);
    }
    setPasteText('');
    setPasteOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Environment variables</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={copyAll} disabled={!value.some((r) => r.key)}>
            <ClipboardCopy className="h-4 w-4" />
            Copy .env
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste className="h-4 w-4" />
            Paste .env
          </Button>
        </div>
      </div>

      {value.length > 4 ? (
        <Input icon={Search} placeholder="Search variables by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      ) : null}

      {value.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No environment variables yet.</p> : null}

      <div className="custom-scrollbar max-h-[420px] overflow-y-auto pr-1 space-y-2">
        {needle && visibleCount === 0 ? <p className="py-3 text-sm text-[var(--text-muted)]">No variables match “{query}”.</p> : null}
        {value.map((row, idx) => {
          // Rows still being typed (empty key) stay visible so they don't vanish mid-edit.
          if (needle && row.key && !row.key.toLowerCase().includes(needle)) return null;
          const keyError = row.key && /[=\r\n]/.test(row.key) ? 'Key cannot contain "="' : null;
          const dupError = !keyError && row.key && keyCounts[row.key] > 1 ? 'Duplicate key' : null;
          return (
            <div key={idx} className="flex items-start gap-2">
              <div className="w-2/5">
                <Input
                  placeholder="KEY"
                  value={row.key}
                  onChange={(e) => updateRow(idx, { key: e.target.value })}
                  error={keyError || dupError}
                  className="font-mono"
                />
              </div>
              <div className="relative flex-1">
                <Input
                  placeholder="value"
                  type={revealed.has(idx) ? 'text' : 'password'}
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                  className="pr-11 font-mono"
                />
                <button
                  type="button"
                  onClick={() => toggleReveal(idx)}
                  className="absolute right-0.5 top-1/2 flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={revealed.has(idx) ? 'Hide value' : 'Reveal value'}
                >
                  {revealed.has(idx) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="mt-[2px] flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:text-rose-500"
                aria-label="Remove variable"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4" />
        Add variable
      </Button>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste .env"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyPaste}>Apply</Button>
          </>
        }
      >
        <Textarea rows={10} placeholder={'KEY=value\n# comments and quotes are handled'} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        <p className="text-xs text-[var(--text-muted)]">Lines starting with # are ignored. Existing keys are overwritten by the pasted values.</p>
      </Modal>
    </div>
  );
}
