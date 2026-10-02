import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, ArrowDownToLine, Pause } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadFile } from '../lib/download.js';

const STREAM_CLASS = {
  stderr: 'text-rose-500',
  error: 'text-rose-500',
  cmd: 'text-[var(--brand)]',
  info: 'text-[var(--text-muted)]',
  stdout: 'text-[var(--text-secondary)]',
};

const MAX_RENDERED = 3000;

export function LogViewer({
  entries = [],
  steps = [],
  downloadUrl,
  filename = 'deployment.log',
  className = '',
  stepFilter: controlledStepFilter,
  onStepFilterChange,
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [internalStepFilter, setInternalStepFilter] = useState('all');
  const stepFilter = controlledStepFilter ?? internalStepFilter;
  const setStepFilter = onStepFilterChange ?? setInternalStepFilter;
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  const filtered = useMemo(
    () => (stepFilter === 'all' ? entries : entries.filter((e) => e.step === stepFilter)),
    [entries, stepFilter]
  );
  const visible = filtered.length > MAX_RENDERED ? filtered.slice(filtered.length - MAX_RENDERED) : filtered;
  const hiddenCount = filtered.length - visible.length;

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (!atBottom && autoScroll) setAutoScroll(false);
  };

  const handleCopy = async () => {
    const text = filtered.map((e) => e.text).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Log copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleDownload = async () => {
    try {
      await downloadFile(downloadUrl, { fallbackFilename: filename, errorMessage: 'Could not download log' });
    } catch (err) {
      toast.error(err.message || 'Could not download log');
    }
  };

  return (
    <div className={['flex flex-col gap-2', className].join(' ')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {steps.length ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setStepFilter('all')}
              className={[
                'min-h-[38px] rounded-full px-3 text-xs font-medium transition-colors',
                stepFilter === 'all' ? 'bg-[var(--brand)] text-white' : 'glass-light text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              All
            </button>
            {steps.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepFilter(s.id)}
                className={[
                  'min-h-[38px] rounded-full px-3 text-xs font-medium transition-colors',
                  stepFilter === s.id ? 'bg-[var(--brand)] text-white' : 'glass-light text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                ].join(' ')}
              >
                {s.label ?? s.type}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            className={[
              'flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors',
              autoScroll ? 'text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            ].join(' ')}
          >
            {autoScroll ? <ArrowDownToLine className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy log"
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Copy className="h-4 w-4" />
          </button>
          {downloadUrl ? (
            <button
              type="button"
              onClick={handleDownload}
              title="Download log"
              className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Download className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="custom-scrollbar max-h-[60vh] overflow-y-auto rounded-2xl border border-black/[0.06] bg-black/[0.03] p-3 font-mono text-[12px] leading-relaxed dark:border-white/10 dark:bg-black/40"
      >
        {hiddenCount > 0 ? (
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">Showing last {MAX_RENDERED.toLocaleString()} of {filtered.length.toLocaleString()} lines</p>
        ) : null}
        {visible.length === 0 ? (
          <p className="text-[var(--text-muted)]">No log output yet.</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.i} className={['whitespace-pre-wrap break-all', STREAM_CLASS[entry.stream] ?? 'text-[var(--text-secondary)]'].join(' ')}>
              {entry.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
