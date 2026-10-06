import { Check, X, Minus, Loader2 } from 'lucide-react';

const DOT_CLASS = {
  pending: 'bg-black/10 dark:bg-white/10 text-[var(--text-muted)]',
  running: 'bg-[var(--brand)] text-white dark:text-[#0B0D11]',
  success: 'bg-teal-500 text-white dark:text-[#0B0D11]',
  failed: 'bg-rose-500 text-white',
  skipped: 'bg-black/10 dark:bg-white/10 text-[var(--text-muted)]',
};

const ICON = { success: Check, failed: X, skipped: Minus };

function formatDuration(step) {
  if (step.status === 'running') return 'running…';
  if (!step.startedAt || !step.endedAt) return step.status === 'skipped' ? 'disabled' : '—';
  const ms = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function StepTimeline({ steps = [], activeStepId = 'all', onSelect, className = '' }) {
  return (
    <ol className={['custom-scrollbar max-h-[520px] overflow-y-auto pr-1 space-y-1', className].join(' ')}>
      {steps.map((step, idx) => {
        const Icon = ICON[step.status];
        const isLast = idx === steps.length - 1;
        const selected = activeStepId === step.id;
        return (
          <li key={step.id} className="relative flex gap-3 pb-1">
            {!isLast ? <span className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-black/[0.06] dark:bg-white/10" /> : null}
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              className="flex w-full items-start gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              <span
                className={[
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  DOT_CLASS[step.status] ?? DOT_CLASS.pending,
                ].join(' ')}
              >
                {step.status === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : Icon ? (
                  <Icon className="h-4 w-4" />
                ) : (
                  idx + 1
                )}
              </span>
              <span className="flex-1 pt-1">
                <span
                  className={[
                    'block text-sm font-medium',
                    selected ? 'text-[var(--brand)]' : 'text-[var(--text-primary)]',
                    step.status === 'running' ? 'animate-pulse' : '',
                  ].join(' ')}
                >
                  {step.label ?? step.type}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{formatDuration(step)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
