import { GripVertical, ChevronUp, ChevronDown, Plus, Trash2, Info } from 'lucide-react';
import { Toggle } from './ui/Toggle.jsx';
import { Input } from './ui/Input.jsx';
import { Button } from './ui/Button.jsx';

const ORDER_BEFORE = ['gitSync', 'nodeSetup', 'writeEnv', 'install', 'build'];
const ORDER_AFTER = ['pm2', 'healthCheck', 'nginx'];
const LOCKED_TYPES = new Set(['gitSync', 'nodeSetup']);

const LABELS = {
  gitSync: 'Sync repository',
  nodeSetup: 'Node.js setup',
  writeEnv: 'Write environment file',
  install: 'Install dependencies',
  build: 'Build',
  pm2: 'Start with PM2',
  healthCheck: 'Health check',
  nginx: 'Nginx routing',
};

function priority(type) {
  const before = ORDER_BEFORE.indexOf(type);
  if (before !== -1) return before;
  if (type === 'custom') return ORDER_BEFORE.length;
  const after = ORDER_AFTER.indexOf(type);
  return ORDER_BEFORE.length + 1 + after;
}

function customIndices(value) {
  return value.map((s, i) => (s.type === 'custom' ? i : -1)).filter((i) => i !== -1);
}

function StepRow({ step, index, onToggle, onConfigChange, children }) {
  const locked = LOCKED_TYPES.has(step.type);
  return (
    <div className="glass-light space-y-3 rounded-2xl border border-white/60 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Toggle checked={step.enabled} onChange={(v) => !locked && onToggle(index, v)} disabled={locked} />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">{LABELS[step.type] ?? step.type}</p>
            {locked ? <p className="text-xs text-[var(--text-muted)]">Always runs</p> : null}
          </div>
        </div>
      </div>
      {step.enabled && children ? <div className="space-y-3 pl-[52px]">{children(step.config, (patch) => onConfigChange(index, patch))}</div> : null}
    </div>
  );
}

export function StepsEditor({ value: rawValue = [], onChange }) {
  // Empty config objects can be dropped by the DB layer; always hand rows a config object.
  const value = rawValue.map((s) => (s.config ? s : { ...s, config: {} }));
  const setAt = (index, patch) => onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const setConfigAt = (index, patch) => setAt(index, { config: { ...value[index].config, ...patch } });
  const toggleAt = (index, enabled) => setAt(index, { enabled });

  const addCustom = () => onChange([...value, { type: 'custom', enabled: true, config: { label: 'Custom step', command: '' } }]);
  const removeAt = (index) => onChange(value.filter((_, i) => i !== index));
  const moveCustom = (index, direction) => {
    const indices = customIndices(value);
    const pos = indices.indexOf(index);
    const swapPos = pos + direction;
    if (swapPos < 0 || swapPos >= indices.length) return;
    const swapIndex = indices[swapPos];
    const next = [...value];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange(next);
  };

  const ordered = value.map((step, index) => ({ step, index })).sort((a, b) => priority(a.step.type) - priority(b.step.type));
  const beforeAndCustom = ordered.filter(({ step }) => priority(step.type) <= ORDER_BEFORE.length);
  const after = ordered.filter(({ step }) => priority(step.type) > ORDER_BEFORE.length);

  return (
    <div className="space-y-3">
      {beforeAndCustom.map(({ step, index }) => {
        if (step.type === 'custom') {
          const indices = customIndices(value);
          const pos = indices.indexOf(index);
          return (
            <div key={index} className="glass-light space-y-3 rounded-2xl border border-white/60 p-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <Toggle checked={step.enabled} onChange={(v) => toggleAt(index, v)} />
                <GripVertical className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <div className="flex-1">
                  <Input
                    value={step.config.label ?? ''}
                    onChange={(e) => setConfigAt(index, { label: e.target.value })}
                    placeholder="Step label"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pos === 0}
                    onClick={() => moveCustom(index, -1)}
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={pos === indices.length - 1}
                    onClick={() => moveCustom(index, 1)}
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-rose-500"
                    aria-label="Remove step"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {step.enabled ? (
                <Input
                  value={step.config.command ?? ''}
                  onChange={(e) => setConfigAt(index, { command: e.target.value })}
                  placeholder="npx prisma migrate deploy"
                  className="font-mono"
                />
              ) : null}
            </div>
          );
        }

        if (step.type === 'install' || step.type === 'build') {
          return (
            <StepRow key={index} step={step} index={index} onToggle={toggleAt} onConfigChange={setConfigAt}>
              {(config, patch) => (
                <Input
                  label="Command"
                  value={config.command ?? ''}
                  onChange={(e) => patch({ command: e.target.value })}
                  className="font-mono"
                />
              )}
            </StepRow>
          );
        }

        return <StepRow key={index} step={step} index={index} onToggle={toggleAt} onConfigChange={setConfigAt} />;
      })}

      <div className="flex items-start gap-2 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs text-[var(--text-secondary)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
        <span>Custom step commands run directly (shell:false) — pipes, <code>&amp;&amp;</code> and other shell operators aren't supported. Use one command per step.</span>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={addCustom}>
        <Plus className="h-4 w-4" />
        Add custom step
      </Button>

      {after.map(({ step, index }) => {
        if (step.type === 'pm2') {
          return (
            <StepRow key={index} step={step} index={index} onToggle={toggleAt} onConfigChange={setConfigAt}>
              {(config, patch) => (
                <Input label="Start command" value={config.command ?? ''} onChange={(e) => patch({ command: e.target.value })} className="font-mono" />
              )}
            </StepRow>
          );
        }
        if (step.type === 'healthCheck') {
          return (
            <StepRow key={index} step={step} index={index} onToggle={toggleAt} onConfigChange={setConfigAt}>
              {(config, patch) => (
                <>
                  <Input label="Path" value={config.path ?? '/'} onChange={(e) => patch({ path: e.target.value })} className="font-mono" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Timeout (sec)"
                      type="number"
                      value={config.timeoutSec ?? 60}
                      onChange={(e) => patch({ timeoutSec: Number(e.target.value) })}
                    />
                    <Input
                      label="Interval (sec)"
                      type="number"
                      value={config.intervalSec ?? 2}
                      onChange={(e) => patch({ intervalSec: Number(e.target.value) })}
                    />
                  </div>
                  <Toggle checked={config.autoRollback !== false} onChange={(v) => patch({ autoRollback: v })} label="Auto-rollback on failure" />
                </>
              )}
            </StepRow>
          );
        }
        if (step.type === 'nginx') {
          return (
            <StepRow key={index} step={step} index={index} onToggle={toggleAt} onConfigChange={setConfigAt}>
              {(config, patch) => (
                <>
                  <Input label="Path" value={config.path ?? ''} onChange={(e) => patch({ path: e.target.value })} className="font-mono" />
                  <Toggle checked={config.stripPrefix !== false} onChange={(v) => patch({ stripPrefix: v })} label="Strip path prefix" />
                </>
              )}
            </StepRow>
          );
        }
        return null;
      })}
    </div>
  );
}
