import { useEffect, useRef, useState } from 'react';
import { Logo } from '../ui/Logo.jsx';
import { Rocket, Server, LayoutGrid, Plug, Layers, Globe, CheckCircle2, Undo2, MapPin, Loader2 } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill.jsx';
import { DEPLOY_LOG, LOG_TONE, LOG_PREFIX } from './logScript.js';

const NAV = [
  { icon: LayoutGrid, label: 'Apps', active: true },
  { icon: Rocket, label: 'Deployments' },
  { icon: Plug, label: 'Ports & routes' },
  { icon: Server, label: 'Resources' },
];

const APPS = [
  { name: 'shop-api', kind: 'Backend', meta: 'Node 20 · port 4001', status: 'online', icon: Server },
  { name: 'marketing-site', kind: 'Website', meta: 'Static files via Nginx', status: 'online', icon: Globe },
];

// A miniature of the real dashboard: click Deploy on a card to replay a deploy log.
export function HeroMock() {
  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  const logRef = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const deploy = () => {
    if (running) return;
    clearInterval(timer.current);
    setLines([]);
    setDone(false);
    setRunning(true);
    let i = 0;
    timer.current = setInterval(() => {
      const next = DEPLOY_LOG[i];
      i += 1;
      setLines((prev) => [...prev, next]);
      if (i >= DEPLOY_LOG.length) {
        clearInterval(timer.current);
        setRunning(false);
        setDone(true);
      }
    }, 420);
  };

  // Autoplay once so the mock isn't static on first view.
  useEffect(() => {
    const t = setTimeout(deploy, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div
        className="surface-overlay overflow-hidden rounded-[20px] shadow-[0_32px_64px_rgba(15,23,42,0.18)]"
        style={{ transform: 'perspective(1400px) rotateY(-4deg) rotateX(2deg)' }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--premium-border)] bg-base-200 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <div className="flex flex-1 items-center gap-1.5 rounded-md bg-base-100 px-2.5 py-1 text-[10px] text-[var(--text-muted)]">
            <MapPin className="h-3 w-3" />
            deploy.yourdomain.com
          </div>
        </div>

        <div className="grid min-h-[380px] grid-cols-[104px_1fr] sm:grid-cols-[140px_1fr]">
          <aside className="flex flex-col gap-1 border-r border-[var(--premium-border)] bg-base-200/70 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <Logo className="h-6 w-auto" />
              <span className="hidden text-[11px] font-bold sm:inline">Deploy</span>
            </div>
            <div className="mb-1 flex items-center gap-1.5 rounded-lg border border-[var(--premium-border)] bg-base-100 px-2 py-1.5 text-[10px] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
              PROD_EC2
            </div>
            {NAV.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
                  active ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-secondary)]'
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            ))}
            <div className="mt-auto flex items-center gap-1.5 px-1 pt-3 text-[10px] text-[var(--text-muted)]">
              <Layers className="h-3 w-3" />
              All servers
            </div>
          </aside>

          <div className="space-y-3 p-3 sm:p-4">
            <div>
              <p className="text-sm font-bold">Apps</p>
              <p className="text-[10px] text-[var(--text-muted)]">Everything deployed on this server</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {APPS.map(({ name, kind, meta, status, icon: Icon }, idx) => (
                <div key={name} className="surface rounded-xl p-2.5">
                  <div className="flex items-start justify-between gap-1">
                    <p className="truncate text-[11px] font-bold">{name}</p>
                    <StatusPill tone={idx === 0 && running ? 'brand' : 'teal'} pulse={idx === 0 && running}>
                      {idx === 0 && running ? 'deploying' : status}
                    </StatusPill>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--text-muted)]">
                    <Icon className="h-2.5 w-2.5" />
                    {kind} · {meta}
                  </p>
                  {idx === 0 ? (
                    <button
                      type="button"
                      onClick={deploy}
                      disabled={running}
                      className="btn-primary-cta mt-2 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold disabled:opacity-70"
                    >
                      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                      {running ? 'Deploying' : 'Deploy'}
                    </button>
                  ) : (
                    <p className="mt-2 text-[9px] text-[var(--text-muted)]">Deployed 2h ago</p>
                  )}
                </div>
              ))}
            </div>

            <div className="surface-inset rounded-xl p-2.5">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Live deploy log</p>
              <div ref={logRef} className="custom-scrollbar h-[130px] space-y-0.5 overflow-y-auto font-mono text-[10px] leading-relaxed">
                {lines.length === 0 ? <p className="text-[var(--text-muted)]">Waiting for a deploy…</p> : null}
                {lines.map((line, i) => (
                  <p key={i} className={`animate-row-in ${LOG_TONE[line.kind]}`}>
                    <span className="mr-1.5 opacity-70">{LOG_PREFIX[line.kind]}</span>
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`animate-sway absolute -bottom-5 -left-4 hidden items-center gap-2 rounded-xl border border-emerald-500/30 bg-base-100 p-3 text-xs shadow-lifted transition-all duration-500 sm:flex ${
          done ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        <div>
          <p className="font-bold">Deploy succeeded</p>
          <p className="text-[var(--text-muted)]">shop-api · 24s</p>
        </div>
      </div>
      <div
        className="animate-sway absolute -right-3 -top-4 hidden items-center gap-2 rounded-xl border border-[var(--premium-border)] bg-base-100 p-3 text-xs shadow-lifted md:flex"
        style={{ animationDelay: '0.5s' }}
      >
        <Undo2 className="h-5 w-5 text-[var(--brand)]" />
        <div>
          <p className="font-bold">One-click rollback</p>
          <p className="text-[var(--text-muted)]">to any past deploy</p>
        </div>
      </div>
    </div>
  );
}
