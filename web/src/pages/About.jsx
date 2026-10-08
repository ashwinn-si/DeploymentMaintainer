import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Rocket, Github, Server, GitBranch, Plug, Layers, KeyRound, DownloadCloud, Cpu, ArrowRight,
  Check, Copy, Star, GitFork, Globe, MapPin, ChevronDown, Menu, X, Sparkles, Package, FileCode2, ExternalLink,
  TerminalSquare, Shuffle, EyeOff,
} from 'lucide-react';
import { Logo } from '../components/ui/Logo.jsx';
import { Reveal } from '../components/ui/Reveal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ThemeToggle } from '../components/layout/ThemeToggle.jsx';
import { HeroMock } from '../components/about/HeroMock.jsx';
import { ServersMock, PipelineMock, LogsMock, RollbackMock } from '../components/about/FeatureMocks.jsx';

const REPO = { owner: 'ashwinn-si', name: 'DeploymentMaintainer' };
const REPO_URL = `https://github.com/${REPO.owner}/${REPO.name}`;
const DEV = {
  name: 'Ashwin S I',
  handle: 'ashwinn-si',
  location: 'Chennai, India',
  github: 'https://github.com/ashwinn-si',
  site: 'https://www.ashwinsi.in/',
  avatar: 'https://avatars.githubusercontent.com/u/157616411?v=4',
};
// Guests are sent to sign in; signed-in users go straight to their servers.
function useDashboardPath() {
  const { user } = useAuth();
  return user ? '/' : '/login';
}

const CLONE_CMD = `git clone ${REPO_URL}.git`;

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#open-source', label: 'GitHub' },
  { href: '#developer', label: 'Developer' },
  { href: '#faq', label: 'FAQ' },
];

const STACK = ['React', 'Vite', 'Tailwind CSS', 'Node.js', 'Express', 'MongoDB', 'PM2', 'Nginx', 'fnm', 'GitHub API', 'AWS EC2', 'Server-Sent Events'];

const PROBLEMS = [
  { icon: TerminalSquare, title: 'SSH, pull, pray', text: 'Every release means logging in, git pull, npm install, restarting the process by hand, and hoping nothing broke.' },
  { icon: Shuffle, title: 'Ports and Nginx by hand', text: 'Each app needs its own port and a hand-edited Nginx block. Two apps grab the same port and one quietly dies.' },
  { icon: EyeOff, title: 'No history, no way back', text: 'When a deploy breaks, there are no logs to read and no quick way to get the last working version back.' },
];

const FEATURE_ROWS = [
  {
    title: 'One dashboard, every server',
    text: 'Register each EC2 box once and switch between them from a sidebar. The dashboard talks to a small agent on each machine, so the browser never touches your servers directly.',
    bullets: ['Add, rename, rotate secrets and remove servers', 'Live status: online, offline or secret rejected', 'Every server keeps its own apps and deploy history'],
    Mock: ServersMock,
  },
  {
    title: 'A pipeline you control',
    text: 'A deploy is an ordered list of steps. Keep the defaults for a standard Node API, or switch steps on and off and add your own commands.',
    bullets: ['Git sync, install, build, PM2, health check, Nginx', 'Custom steps such as database migrations', 'Per-app Node version, installed through fnm'],
    Mock: PipelineMock,
  },
  {
    title: 'Watch it deploy, live',
    text: 'Logs stream to the page while the deploy runs, step by step. Open any past deployment to see its commit, timeline and full output.',
    bullets: ['Live streaming over Server-Sent Events', 'Secrets are masked in the log', 'Cancel, copy or download any log'],
    Mock: LogsMock,
  },
  {
    title: 'Roll back in one click',
    text: 'Every successful deploy is kept. If a release is bad, go back to any earlier one. Turn the health check on and a failed deploy can roll itself back.',
    bullets: ['Manual rollback to any past successful deploy', 'Optional auto-rollback on a failed health check', 'Update in place or do a fresh re-clone'],
    Mock: RollbackMock,
  },
];

const MORE = [
  { icon: Sparkles, title: 'Auto-detects your project', text: 'Reads the repo and picks Node server, frontend build or static HTML for you.' },
  { icon: Package, title: 'Frontend apps, no process', text: 'Vite, React, Astro and similar are built on deploy and served as static files by Nginx.' },
  { icon: FileCode2, title: 'Plain HTML sites', text: 'HTML, CSS and JS served as they are. No build, no port, no PM2.' },
  { icon: Plug, title: 'Ports and routes', text: 'Free ports are assigned automatically and each app gets a URL path like /my-app.' },
  { icon: GitBranch, title: 'Any branch, side by side', text: 'Duplicate an app to run another branch next to the first one with its own port and env.' },
  { icon: KeyRound, title: 'Encrypted environment', text: 'Env values are encrypted at rest with AES-256-GCM and masked in the UI.' },
  { icon: Cpu, title: 'Server resources', text: 'CPU, memory and disk with an hour of history, plus per-app memory and disk use.' },
  { icon: DownloadCloud, title: 'Backup and restore', text: 'Export your apps to a passphrase-encrypted file and import them on another server.' },
];

const STEPS = [
  { title: 'Add a server', text: 'Generate an ID and secret in the dashboard, paste them into the agent\'s .env on your EC2 instance, and it registers.' },
  { title: 'Pick a repo and branch', text: 'Choose from your GitHub repositories. main or master is selected for you and the project type is detected.' },
  { title: 'Set env vars and steps', text: 'Add environment variables, check the pipeline, and choose the port or let one be assigned.' },
  { title: 'Deploy', text: 'Press Deploy and watch the log. Every later release is one click.' },
];

const STATS = [
  { value: '1', label: 'dashboard for all your servers' },
  { value: '3', label: 'app types, auto-detected' },
  { value: '10', label: 'pipeline step types' },
  { value: '1-click', label: 'deploys and rollbacks' },
];

const FAQ = [
  { q: 'Do I need Vercel, Docker or Kubernetes?', a: 'No. It runs on plain Ubuntu servers: a Node agent, PM2 for processes and Nginx for routing. Nothing else to install on the box besides what the setup guide lists.' },
  { q: 'Where do my secrets live?', a: 'Environment values are encrypted at rest with AES-256-GCM. Each agent has its own database and key, and the dashboard stores server secrets encrypted too. Values are masked in the UI and the deploy logs.' },
  { q: 'What project types work?', a: 'Node servers run under PM2 behind Nginx. Frontend apps (Vite, Create React App, Astro and similar) are built during deploy and served as static files. Plain HTML is served as it is. The type is detected from the repository root.' },
  { q: 'Is the health check required?', a: 'No, it is off by default. If you turn it on, your app needs an endpoint such as GET /health that returns 200 on its port. The steps editor shows a prompt you can copy to add one.' },
  { q: 'What happens if a deploy fails?', a: 'The deployment is marked failed and the log shows which step broke. The previous release is still available, so you can roll back with one click. With a health check on, you can enable auto-rollback.' },
  { q: 'Can I manage more than one server?', a: 'Yes. Add as many as you like and switch between them. Each server runs its own agent and keeps its own apps and history.' },
];

function SectionHeader({ eyebrow, title, children }) {
  return (
    <Reveal className="mx-auto mb-14 max-w-2xl text-center">
      <span className="label-eyebrow">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl md:text-5xl">{title}</h2>
      {children ? <p className="mt-4 text-[var(--text-muted)]">{children}</p> : null}
    </Reveal>
  );
}

function Navbar() {
  const dashboardPath = useDashboardPath();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fixed inset-x-0 top-0 z-40 ui-transition ${scrolled || open ? 'surface-overlay !rounded-none !border-x-0 !border-t-0' : ''}`}>
      <nav className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 font-heading text-lg">
          <Logo className="h-9 w-auto" />
          <span><span className="font-bold">Deploy</span> <span className="font-light text-[var(--brand)]">Maintainer</span></span>
        </a>
        <div className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="text-sm font-medium text-[var(--text-muted)] ui-transition hover:text-[var(--text-primary)]">{n.label}</a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to={dashboardPath} className="btn-base btn-primary-cta hidden items-center gap-1.5 !min-h-[40px] px-4 text-sm sm:inline-flex">
            Open dashboard <ArrowRight className="h-4 w-4" />
          </Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--premium-border)] md:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      {open ? (
        <div className="animate-dropdown-in space-y-1 border-t border-[var(--premium-border)] px-4 pb-4 pt-2 md:hidden">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-base-200">{n.label}</a>
          ))}
          <Link to={dashboardPath} className="btn-base btn-primary-cta mt-2 flex items-center justify-center gap-1.5 text-sm">Open dashboard <ArrowRight className="h-4 w-4" /></Link>
        </div>
      ) : null}
    </header>
  );
}

function Hero() {
  const dashboardPath = useDashboardPath();
  return (
    <section id="top" className="relative overflow-hidden pb-20 pt-28 md:pb-32 md:pt-40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="animate-orb-float-1 absolute -left-32 -top-20 h-[500px] w-[500px] rounded-full bg-primary/10 blur-3xl md:h-[800px] md:w-[800px]" />
        <div className="animate-orb-float-2 absolute -right-40 top-40 h-[400px] w-[400px] rounded-full bg-secondary/10 blur-3xl md:h-[600px] md:w-[600px]" />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(var(--brand) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>
      <div className="container relative mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--premium-border)] bg-[var(--brand-soft)] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            Self-hosted · Open source
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-7xl">
            Your own Vercel,
            <br />
            on <span className="text-gradient">your own servers.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">
            Deployment Maintainer is a dashboard for deploying GitHub repos to your EC2 instances. Pick a repo and branch, set env vars, press Deploy. Live logs, health checks, one-click rollback and Nginx routing are built in.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={dashboardPath} className="btn-base btn-primary-cta inline-flex items-center gap-2 px-6">
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center gap-2 px-6">
              <Github className="h-4 w-4" /> View on GitHub
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-muted)]">
            {['Many servers, one login', 'No Docker or Kubernetes', 'Your data stays on your boxes'].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} /> {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.12}>
          <HeroMock />
        </Reveal>
      </div>
    </section>
  );
}

function StackStrip() {
  const items = [...STACK, ...STACK];
  return (
    <section className="marquee relative overflow-hidden border-y border-[var(--premium-border)] py-12">
      <p className="mb-6 text-center text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Built with and for</p>
      <div className="flex w-max animate-marquee gap-3">
        {items.map((s, i) => (
          <span key={i} className="surface rounded-full px-5 py-2.5 text-sm font-semibold text-[var(--text-secondary)]">{s}</span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20" style={{ background: 'linear-gradient(to right, var(--color-base-100), transparent)' }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20" style={{ background: 'linear-gradient(to left, var(--color-base-100), transparent)' }} />
    </section>
  );
}

function Problems() {
  return (
    <section className="bg-base-200 py-20">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader eyebrow="The problem" title="Sound familiar?" />
        <div className="grid gap-6 md:grid-cols-3">
          {PROBLEMS.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 0.1}>
              <div className="surface surface-interactive h-full rounded-2xl border-l-[3px] !border-l-[var(--brand)] p-7">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="mt-2 text-[var(--text-muted)]">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-28">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader eyebrow="Features" title={<>Everything you need.<br />Nothing you don&apos;t.</>} />
        <div className="space-y-20 sm:space-y-28">
          {FEATURE_ROWS.map(({ title, text, bullets, Mock }, i) => (
            <Reveal key={title} className="grid items-center gap-8 sm:gap-14 lg:grid-cols-2">
              <div>
                <span className="btn-primary-cta mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl !border-0 font-heading text-base font-extrabold">{i + 1}</span>
                <h3 className="text-2xl font-bold sm:text-3xl md:text-4xl">{title}</h3>
                <p className="mt-4 text-base text-[var(--text-muted)] sm:text-lg">{text}</p>
                <ul className="mt-6 space-y-2.5">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-center gap-3 text-sm ui-transition hover:translate-x-1">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? 'lg:order-first' : ''}>
                <Mock />
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-28 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={(i % 4) * 0.08}>
              <div className="surface surface-interactive h-full rounded-2xl p-6">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
                <h3 className="text-base font-bold">{title}</h3>
                <p className="mt-1.5 text-sm text-[var(--text-muted)]">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 bg-base-200 py-24">
      <div className="container mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeader eyebrow="Getting started" title="Up and running in minutes." />
        <div className="relative space-y-8">
          <div className="absolute bottom-6 left-[30px] top-6 hidden w-px bg-gradient-to-b from-[var(--brand)]/40 to-transparent md:block" />
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08} className="relative flex items-start gap-6">
              <span className="btn-primary-cta relative z-10 flex h-[60px] w-[60px] shrink-0 items-center justify-center !rounded-full font-heading text-lg font-extrabold">{String(i + 1).padStart(2, '0')}</span>
              <div className="surface flex-1 rounded-2xl p-6">
                <h3 className="text-xl font-bold">{s.title}</h3>
                <p className="mt-1.5 text-[var(--text-muted)]">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-20 py-24">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader eyebrow="Under the hood" title="A control plane and one agent per server.">
          The browser only ever talks to the dashboard. It forwards requests to the right agent with a secret, so your servers need no CORS and no user accounts.
        </SectionHeader>
        <Reveal className="grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1.4fr]">
          <div className="surface rounded-2xl p-6 text-center">
            <Globe className="mx-auto h-7 w-7 text-[var(--brand)]" />
            <h3 className="mt-3 text-lg font-bold">Browser</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Signs in with one admin login. Never calls an agent directly.</p>
          </div>
          <div className="flex items-center justify-center text-[var(--brand)]"><ArrowRight className="h-6 w-6 rotate-90 lg:rotate-0" /></div>
          <div className="space-y-4">
            <div className="surface rounded-2xl border-[var(--brand)]/40 p-6">
              <div className="flex items-center gap-2"><Layers className="h-5 w-5 text-[var(--brand)]" /><h3 className="text-lg font-bold">Control plane</h3></div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Serves the dashboard, owns the login, stores each server&apos;s URL and encrypted secret, and proxies API calls.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {['Agent on server A', 'Agent on server B'].map((a) => (
                <div key={a} className="surface-inset rounded-2xl p-5">
                  <div className="flex items-center gap-2"><Server className="h-4 w-4 text-[var(--brand)]" /><h4 className="text-sm font-bold">{a}</h4></div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Runs the deploy pipeline, keeps its own apps and history, serves them through Nginx and PM2.</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="bg-neutral py-16 text-neutral-content md:py-20">
      <div className="container mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 sm:px-6 md:grid-cols-4 md:gap-0 md:divide-x md:divide-white/10">
        {STATS.map((s) => (
          <div key={s.label} className="px-4 text-center">
            <p className="font-heading text-4xl font-extrabold text-white md:text-5xl">{s.value}</p>
            <p className="mt-1 text-sm text-white/60">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function OpenSource() {
  const [stats, setStats] = useState(null);
  const [copied, setCopied] = useState(false);

  // Public GitHub API; the card renders fine without the numbers if this fails or is rate limited.
  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.name}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setStats({ stars: d.stargazers_count, forks: d.forks_count, issues: d.open_issues_count, pushed: d.pushed_at });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CLONE_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the command is still selectable
    }
  };

  return (
    <section id="open-source" className="scroll-mt-20 bg-base-200 py-24">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6">
        <SectionHeader eyebrow="Open source" title="Read it, run it, change it.">
          The whole project is public on GitHub: the dashboard, the control plane and the server agent.
        </SectionHeader>
        <Reveal>
          <div className="surface overflow-hidden rounded-3xl">
            <div className="h-1.5 bg-gradient-to-r from-[#5b21b6] via-[#6d28d9] to-[#4f46e5]" />
            <div className="space-y-6 p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral text-white"><Github className="h-6 w-6" /></span>
                  <div>
                    <p className="text-lg font-bold">{REPO.owner}/{REPO.name}</p>
                    <p className="text-sm text-[var(--text-muted)]">Public · JavaScript · Node.js, React</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {stats ? (
                    <>
                      <span className="surface-inset inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold"><Star className="h-4 w-4 text-amber-500" />{stats.stars}</span>
                      <span className="surface-inset inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold"><GitFork className="h-4 w-4 text-[var(--brand)]" />{stats.forks}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-3">
                {[
                  ['web/', 'React dashboard (Vite, Tailwind, DaisyUI)'],
                  ['control/', 'Control plane: login, servers, proxy'],
                  ['server/', 'Agent: deploys, PM2, Nginx, monitor'],
                ].map(([dir, desc]) => (
                  <div key={dir} className="surface-inset rounded-xl p-3">
                    <p className="font-mono text-xs font-semibold text-[var(--brand)]">{dir}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">{desc}</p>
                  </div>
                ))}
              </div>

              <div className="surface-inset flex items-center justify-between gap-3 rounded-xl px-4 py-3">
                <code className="custom-scrollbar overflow-x-auto whitespace-nowrap font-mono text-xs sm:text-sm">$ {CLONE_CMD}</code>
                <button type="button" onClick={copy} aria-label="Copy clone command" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--premium-border)] ui-transition hover:bg-[var(--brand-soft)]">
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-base btn-primary-cta inline-flex items-center gap-2 px-5"><Github className="h-4 w-4" /> View repository</a>
                <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center gap-2 px-5">Report an issue <ExternalLink className="h-3.5 w-3.5" /></a>
                <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center gap-2 px-5">Read the docs</a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Developer() {
  const [imgOk, setImgOk] = useState(true);
  return (
    <section id="developer" className="scroll-mt-20 py-24">
      <div className="container mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeader eyebrow="Developer" title="Built by one person." />
        <Reveal>
          <div className="surface flex flex-col items-center gap-6 rounded-3xl p-8 text-center sm:flex-row sm:text-left">
            {imgOk ? (
              <img src={DEV.avatar} alt={DEV.name} width={96} height={96} onError={() => setImgOk(false)} className="h-24 w-24 shrink-0 rounded-full border-2 border-[var(--premium-border)] object-cover" />
            ) : (
              <span className="btn-primary-cta flex h-24 w-24 shrink-0 items-center justify-center !rounded-full font-heading text-3xl font-extrabold">AS</span>
            )}
            <div className="flex-1">
              <h3 className="text-2xl font-bold">{DEV.name}</h3>
              <p className="text-sm font-medium text-[var(--brand)]">Creator and maintainer of Deployment Maintainer</p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-[var(--text-muted)] sm:justify-start"><MapPin className="h-3.5 w-3.5" />{DEV.location}</p>
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                Built to stop hand-deploying side projects over SSH. Bug reports and pull requests are welcome on GitHub.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                <a href={DEV.github} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center gap-2 px-4 text-sm"><Github className="h-4 w-4" />@{DEV.handle}</a>
                <a href={DEV.site} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center gap-2 px-4 text-sm"><Globe className="h-4 w-4" />ashwinsi.in</a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FAQSection() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="scroll-mt-20 bg-base-200 py-24">
      <div className="container mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6 md:flex-row md:gap-16">
        <Reveal className="md:w-80 lg:w-96">
          <div className="md:sticky md:top-28">
            <span className="label-eyebrow">FAQ</span>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl md:text-5xl">Questions?<br /><span className="text-gradient">Answered.</span></h2>
            <p className="mt-4 text-[var(--text-muted)]">The short version of how it behaves. The full detail is in the repository docs.</p>
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="btn-base btn-primary-cta mt-6 inline-flex items-center gap-2 px-5 text-sm">Ask on GitHub</a>
          </div>
        </Reveal>
        <div className="flex-1 space-y-2">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 0.06}>
                <div className={`rounded-xl border ui-transition ${isOpen ? 'border-[var(--brand)]/30 bg-[var(--brand-soft)]' : 'border-[var(--premium-border)] bg-base-100'}`}>
                  <button type="button" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
                    <span className={`font-semibold ${isOpen ? 'text-[var(--brand)]' : ''}`}>{item.q}</span>
                    <ChevronDown className={`h-5 w-5 shrink-0 ui-transition ${isOpen ? 'rotate-180 text-[var(--brand)]' : 'text-[var(--text-muted)]'}`} />
                  </button>
                  <div className={`grid ui-transition ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <p className="px-5 pb-4 text-[var(--text-muted)]">{item.a}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const dashboardPath = useDashboardPath();
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="animate-orb-float-3 pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
      <Reveal className="container relative mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-4xl font-extrabold md:text-6xl">Ship your next app <span className="text-gradient">in a click.</span></h2>
        <p className="mx-auto mt-5 max-w-xl text-[var(--text-muted)]">Set it up once on your own servers, then every deploy is a button.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={dashboardPath} className="btn-base btn-primary-cta inline-flex items-center justify-center gap-2 px-7"><Rocket className="h-4 w-4" /> Open dashboard</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-base btn-quiet inline-flex items-center justify-center gap-2 px-7"><Github className="h-4 w-4" /> Star on GitHub</a>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  const dashboardPath = useDashboardPath();
  return (
    <footer className="bg-neutral text-neutral-content">
      <div className="container mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 font-heading text-lg text-white">
              <Logo className="h-9 w-auto" />
              <span className="font-bold">Deploy <span className="font-light text-[#a78bfa]">Maintainer</span></span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-white/60">A self-hosted deployment dashboard for your own EC2 instances.</p>
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-white/90">Product</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              {NAV.slice(0, 3).map((n) => <li key={n.href}><a href={n.href} className="hover:text-white">{n.label}</a></li>)}
              <li><Link to={dashboardPath} className="hover:text-white">Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-white/90">Project</h4>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a></li>
              <li><a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="hover:text-white">Issues</a></li>
              <li><a href={DEV.github} target="_blank" rel="noreferrer" className="hover:text-white">Developer</a></li>
              <li><a href={DEV.site} target="_blank" rel="noreferrer" className="hover:text-white">ashwinsi.in</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row">
          <p>© {new Date().getFullYear()} Deployment Maintainer. Built by {DEV.name}.</p>
          <p>Made in India</p>
        </div>
      </div>
    </footer>
  );
}

export function About() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Deployment Maintainer: your own Vercel on your own servers';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <main className="overflow-x-hidden text-[var(--text-primary)]">
      <Navbar />
      <Hero />
      <StackStrip />
      <Problems />
      <Features />
      <HowItWorks />
      <Architecture />
      <Stats />
      <OpenSource />
      <Developer />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </main>
  );
}
