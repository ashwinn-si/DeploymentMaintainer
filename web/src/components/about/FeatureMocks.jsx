import { useEffect, useRef, useState } from 'react';
import { Server, Check, X, Undo2, RotateCcw } from 'lucide-react';
import { Toggle } from '../ui/Toggle.jsx';
import { StatusPill } from '../ui/StatusPill.jsx';
import { DEPLOY_LOG, LOG_TONE, LOG_PREFIX } from './logScript.js';

export function Mock({ children }) {
  return <div className="surface-overlay rounded-[18px] p-4 shadow-lifted ui-transition hover:scale-[1.02] sm:p-5">{children}</div>;
}

const SERVERS = [
  { id: 'a', name: 'PROD_API', host: 'api.example.com', apps: 6, status: 'online' },
  { id: 'b', name: 'STAGING', host: 'staging.example.com', apps: 3, status: 'online' },
  { id: 'c', name: 'SIDE_PROJECTS', host: 'lab.example.com', apps: 4, status: 'offline' },
];

export function ServersMock() {
  const [sel, setSel] = useState('a');
  const server = SERVERS.find((s) => s.id === sel);
  return (
    <Mock>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Servers</p>
      <div className="space-y-2">
        {SERVERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSel(s.id)}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left ui-transition ${
              sel === s.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--premium-border)] hover:bg-base-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${s.status === 'online' ? 'bg-teal-500' : 'bg-rose-500'}`} />
              <span>
                <span className="block text-sm font-semibold">{s.name}</span>
                <span className="block font-mono text-[11px] text-[var(--text-muted)]">{s.host}</span>
              </span>
            </span>
            <StatusPill tone={s.status === 'online' ? 'teal' : 'rose'}>{s.status}</StatusPill>
          </button>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-2 rounded-xl bg-base-200 px-3 py-2 text-xs text-[var(--text-secondary)]">
        <Server className="h-3.5 w-3.5 text-[var(--brand)]" />
        {server.status === 'online' ? `${server.apps} apps running on ${server.name}` : `${server.name} is unreachable, check its agent`}
      </p>
    </Mock>
  );
}

const STEPS = [
  { id: 'sync', label: 'Sync repository', locked: true, on: true },
  { id: 'install', label: 'Install dependencies', on: true },
  { id: 'build', label: 'Build', on: false },
  { id: 'custom', label: 'Custom: prisma migrate deploy', on: true },
  { id: 'pm2', label: 'Start with PM2', on: true },
  { id: 'health', label: 'Health check', on: false },
  { id: 'nginx', label: 'Nginx routing  /shop-api', on: true },
];

export function PipelineMock() {
  const [steps, setSteps] = useState(STEPS);
  const flip = (id, on) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, on } : s)));
  const active = steps.filter((s) => s.on).length;
  return (
    <Mock>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Deploy steps</p>
        <span className="text-[11px] font-semibold text-[var(--brand)]">{active} of {steps.length} on</span>
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div key={s.id} className="surface-inset flex items-center justify-between rounded-xl px-3 py-2">
            <span className="flex items-center gap-2.5 text-sm font-medium">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10px] font-bold text-[var(--brand)]">{i + 1}</span>
              {s.label}
            </span>
            {s.locked ? <span className="text-[11px] text-[var(--text-muted)]">Always runs</span> : <Toggle checked={s.on} onChange={(v) => flip(s.id, v)} />}
          </div>
        ))}
      </div>
    </Mock>
  );
}

export function LogsMock() {
  const [lines, setLines] = useState([]);
  const [run, setRun] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    setLines([]);
    let i = 0;
    const t = setInterval(() => {
      setLines((prev) => [...prev, DEPLOY_LOG[i]]);
      i += 1;
      if (i >= DEPLOY_LOG.length) clearInterval(t);
    }, 550);
    return () => clearInterval(t);
  }, [run]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  return (
    <Mock>
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand)]" />
          Streaming live
        </p>
        <button type="button" onClick={() => setRun((r) => r + 1)} className="flex items-center gap-1 text-[11px] font-semibold text-[var(--brand)] hover:underline">
          <RotateCcw className="h-3 w-3" />
          Replay
        </button>
      </div>
      <div ref={boxRef} className="custom-scrollbar surface-inset h-[230px] space-y-1 overflow-y-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed">
        {lines.map((l, i) => (
          <p key={i} className={`animate-row-in ${LOG_TONE[l.kind]}`}>
            <span className="mr-2 opacity-70">{LOG_PREFIX[l.kind]}</span>
            {l.text}
          </p>
        ))}
      </div>
    </Mock>
  );
}

const HISTORY = [
  { n: 12, sha: 'e91f0aa', status: 'failed', note: 'health check failed' },
  { n: 11, sha: 'a1b2c3d', status: 'success', note: 'auto-rolled back to here' },
  { n: 10, sha: '7cc4d19', status: 'success', note: 'fix: retry webhook' },
  { n: 9, sha: '3fa81be', status: 'success', note: 'feat: invoices' },
];

export function RollbackMock() {
  const [current, setCurrent] = useState(11);
  return (
    <Mock>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Deployment history · shop-api</p>
      <div className="space-y-1.5">
        {HISTORY.map((d) => (
          <div key={d.n} className="surface-inset flex items-center justify-between gap-2 rounded-xl px-3 py-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${d.status === 'success' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
                {d.status === 'success' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">#{d.n} <span className="font-mono text-[11px] font-normal text-[var(--text-muted)]">{d.sha}</span></span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">{d.note}</span>
              </span>
            </span>
            {current === d.n ? (
              <StatusPill tone="brand">live</StatusPill>
            ) : d.status === 'success' ? (
              <button
                type="button"
                onClick={() => setCurrent(d.n)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--premium-border)] px-2 py-1 text-[11px] font-semibold ui-transition hover:bg-[var(--brand-soft)]"
              >
                <Undo2 className="h-3 w-3" />
                Roll back
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Now serving deploy #{current}.</p>
    </Mock>
  );
}
