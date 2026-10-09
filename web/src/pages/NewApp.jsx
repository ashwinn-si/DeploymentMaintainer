import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PlusCircle, Plug, Server, FileCode2, Package, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { RepoPicker } from '../components/RepoPicker.jsx';
import { BranchPicker } from '../components/BranchPicker.jsx';
import { NodeVersionPicker } from '../components/NodeVersionPicker.jsx';
import { EnvEditor } from '../components/EnvEditor.jsx';
import { StepsEditor } from '../components/StepsEditor.jsx';
import { OccupiedPortsModal } from '../components/OccupiedPortsModal.jsx';
import { ApiError } from '../api.js';
import { useServer } from '../context/ServerContext.jsx';

function slugify(input) {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function Section({ step, title, description, children }) {
  return (
    <GlassCard variant="mid">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">
          {step}
        </span>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="text-xs text-[var(--text-muted)]">{description}</p> : null}
        </div>
      </div>
      {children}
    </GlassCard>
  );
}

const PRESETS = [
  { value: 'node', icon: Server, title: 'Node server', text: 'Runs under PM2 on its own port; Nginx proxies to it.' },
  { value: 'frontend', icon: Package, title: 'Frontend app', text: 'Vite, React, Vue, Astro...: built on deploy, then served as static files. No process.' },
  { value: 'html', icon: FileCode2, title: 'Static HTML', text: 'HTML/CSS/JS served as-is by Nginx. No build, no process, no port.' },
];

function detectedPreset(detected) {
  return { 'node-server': 'node', frontend: 'frontend', 'static-html': 'html' }[detected?.type] ?? null;
}

const DETECTED_TITLES = { 'node-server': 'Node.js server', frontend: 'Frontend app', 'static-html': 'Static HTML site' };

function DetectionBanner({ detected, status, preset }) {
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
        Looking at the repository to pick the right project type…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Could not auto-detect the project type, so none is pre-selected. Pick one below.</span>
      </div>
    );
  }
  if (!detected) return null;
  if (detected.type === 'unknown') {
    return (
      <div className="flex items-start gap-2 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs text-[var(--text-secondary)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
        <span>Could not tell what this repository is ({detected.reasons?.[0]}). Pick a type below.</span>
      </div>
    );
  }
  const framework = detected.framework?.label ? ` (${detected.framework.label})` : '';
  return (
    <div className="space-y-1 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs text-[var(--text-secondary)]">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <Sparkles className="h-4 w-4 text-[var(--brand)]" />
        Detected: {DETECTED_TITLES[detected.type]}
        {framework}
      </p>
      {detected.reasons?.map((reason) => <p key={reason}>{reason}</p>)}
      {detectedPreset(detected) && detectedPreset(detected) !== preset ? (
        <p className="font-medium text-amber-700 dark:text-amber-400">
          You picked a different type than detected. A frontend deployed as a Node server will crash with 502 errors, and a backend deployed as a frontend has no process to serve it.
        </p>
      ) : null}
      {detected.type === 'frontend' && detected.baseSupport === 'auto' ? (
        <p>It is served under its own path (<code>/&lt;name&gt;/</code>); the build is given that base path automatically. Your router must use the base URL too.</p>
      ) : null}
      {detected.type === 'frontend' && detected.baseSupport === 'manual' ? (
        <p>The base path cannot be set automatically for this build: {detected.baseHint}. The deploy log shows the values to use.</p>
      ) : null}
    </div>
  );
}

export function NewApp() {
  const navigate = useNavigate();
  const { api, serverPath } = useServer();
  // node = PM2 process; frontend = build then serve static files; html = serve files as-is.
  const [preset, setPreset] = useState('node');
  const [detected, setDetected] = useState(null);
  const [detectStatus, setDetectStatus] = useState('idle');
  const presetTouched = useRef(false);
  const [repoFullName, setRepoFullName] = useState('');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [port, setPort] = useState('');
  const [portTouched, setPortTouched] = useState(false);
  const [showPortsModal, setShowPortsModal] = useState(false);
  const [nodeVersion, setNodeVersion] = useState('');
  const [env, setEnv] = useState([{ key: 'NODE_ENV', value: 'production' }]);
  const [steps, setSteps] = useState([]);
  const [stepsTouched, setStepsTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(null);
  const defaultsRequested = useRef(false);
  const kind = preset === 'node' ? 'node' : 'static';

  useEffect(() => {
    if (!nameTouched && repoFullName && branch) {
      const repoSlug = repoFullName.split('/')[1] ?? repoFullName;
      setName(slugify(`${repoSlug}-${branch}`));
    }
  }, [repoFullName, branch, nameTouched]);

  useEffect(() => {
    const slug = slugify(name);
    if (!slug) return;
    const timer = setTimeout(() => {
      api.apps
        .defaults(slug, kind, preset === 'frontend' ? 'frontend' : undefined)
        .then((data) => {
          if (!portTouched && data.port) setPort(String(data.port));
          if (!stepsTouched && data.steps) setSteps(data.steps);
          defaultsRequested.current = true;
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [api, name, kind, preset, portTouched, stepsTouched]);

  const slug = useMemo(() => slugify(name), [name]);
  const isStatic = kind === 'static';
  const needsNode = preset !== 'html';
  const canSubmit = Boolean(repoFullName && branch && slug && (!needsNode || nodeVersion));

  // The pipeline differs per type, so switching type discards edits and reloads that type's defaults.
  const choosePreset = (next, { fromUser = true } = {}) => {
    if (fromUser) presetTouched.current = true;
    if (next === preset) return;
    setPreset(next);
    setStepsTouched(false);
    setSteps([]);
    if (next !== 'node') setPort('');
    setPortTouched(false);
  };

  // Look at the repo as soon as a branch is picked, and pre-select the matching type unless the user already chose.
  useEffect(() => {
    setDetected(null);
    setDetectStatus('idle');
    if (!repoFullName || !branch) return undefined;
    setDetectStatus('loading');
    const [owner, repo] = repoFullName.split('/');
    let cancelled = false;
    api.repos
      .detectProject(owner, repo, branch)
      .then((result) => {
        if (cancelled) return;
        setDetected(result);
        setDetectStatus('done');
        const mapped = detectedPreset(result);
        if (mapped && !presetTouched.current) choosePreset(mapped, { fromUser: false });
      })
      .catch(() => {
        if (!cancelled) setDetectStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // choosePreset closes over state this effect must not re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, repoFullName, branch]);

  const submit = async (deploy) => {
    setSubmitting(deploy ? 'deploy' : 'create');
    setFormError(null);
    setFieldErrors({});
    try {
      const { app, deployment } = await api.apps.create({
        name: slug,
        kind,
        repoFullName,
        branch,
        port: !isStatic && port ? Number(port) : undefined,
        nodeVersion: needsNode ? nodeVersion : nodeVersion || '20',
        env,
        steps,
        deploy,
      });
      toast.success(`${app.name} created${deploy ? ' — deploying' : ''}`);
      navigate(serverPath(deploy && deployment ? `/deployments/${deployment.id}` : `/apps/${app.id}`));
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        const next = {};
        for (const issue of err.issues) {
          const field = issue.path?.[0];
          if (field) next[field] = issue.message;
        }
        setFieldErrors(next);
        setFormError('Please fix the highlighted fields.');
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Failed to create app');
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={PlusCircle} eyebrow="Deploy" title="New App">
        Pick a repo, configure the pipeline, and deploy.
      </PageHeader>

      <Section step={1} title="Repository" description="Pick the GitHub repo to deploy.">
        <RepoPicker value={repoFullName} onChange={(v) => { presetTouched.current = false; setRepoFullName(v); setBranch(''); }} />
      </Section>

      <Section step={2} title="Branch" description="Which branch this app tracks.">
        <BranchPicker repoFullName={repoFullName} value={branch} onChange={setBranch} />
      </Section>

      <Section step={3} title="Project type" description="How this app is built and served.">
        <div className="space-y-3">
        <DetectionBanner detected={detected} status={detectStatus} preset={preset} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PRESETS.map(({ value, icon: Icon, title, text }) => (
            <button
              key={value}
              type="button"
              onClick={() => choosePreset(value)}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                preset === value ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--premium-border)]'
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand)]" />
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">
                  {title}
                  {detectedPreset(detected) === value ? <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--brand)]">Detected</span> : null}
                </span>
                <span className="block text-xs text-[var(--text-muted)]">{text}</span>
              </span>
            </button>
          ))}
        </div>
        </div>
      </Section>

      <Section step={4} title={isStatic ? 'Name' : 'Name & port'} description="The name becomes the folder name and, if routed, the URL path.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="App name"
            value={name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            error={fieldErrors.name}
            hint={slug && slug !== name ? `Slug: ${slug}` : undefined}
          />
          {isStatic ? null : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Port</span>
              <button
                type="button"
                onClick={() => setShowPortsModal(true)}
                className="flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline"
              >
                <Plug className="h-3.5 w-3.5" />
                View occupied ports
              </button>
            </div>
            <Input
              type="number"
              value={port}
              onChange={(e) => {
                setPortTouched(true);
                setPort(e.target.value);
              }}
              error={fieldErrors.port}
              placeholder="Auto-assigned"
            />
          </div>
          )}
        </div>
      </Section>

      <OccupiedPortsModal
        open={showPortsModal}
        onClose={() => setShowPortsModal(false)}
        onSelectPort={(p) => {
          setPort(String(p));
          setPortTouched(true);
        }}
        currentPort={port}
      />

      {needsNode ? (
        <Section step={5} title="Node version">
          <NodeVersionPicker repoFullName={repoFullName} branch={branch} value={nodeVersion} onChange={setNodeVersion} />
        </Section>
      ) : null}

      {preset === 'html' ? null : (
      <Section step={6} title="Environment variables" description={isStatic ? 'Baked into the build (VITE_*, REACT_APP_*...), so changing them needs a redeploy.' : undefined}>
        <EnvEditor value={env} onChange={setEnv} />
      </Section>
      )}

      <Section step={7} title="Deploy steps" description="What runs, in order, on every deploy.">
        {steps.length ? <StepsEditor value={steps} kind={kind} port={port || null} onChange={(v) => { setStepsTouched(true); setSteps(v); }} /> : (
          <p className="text-sm text-[var(--text-muted)]">Pick a name to load the default pipeline.</p>
        )}
      </Section>

      {formError ? <p className="text-sm text-rose-500">{formError}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={!canSubmit} loading={submitting === 'create'} onClick={() => submit(false)}>
          Create
        </Button>
        <Button disabled={!canSubmit} loading={submitting === 'deploy'} onClick={() => submit(true)}>
          Create &amp; Deploy
        </Button>
      </div>
    </div>
  );
}
