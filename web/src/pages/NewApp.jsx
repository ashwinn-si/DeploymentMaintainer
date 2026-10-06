import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PlusCircle, Plug, Server, FileCode2 } from 'lucide-react';
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

export function NewApp() {
  const navigate = useNavigate();
  const { api, serverPath } = useServer();
  const [kind, setKind] = useState('node');
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
        .defaults(slug, kind)
        .then((data) => {
          if (!portTouched && data.port) setPort(String(data.port));
          if (!stepsTouched && data.steps) setSteps(data.steps);
          defaultsRequested.current = true;
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [api, name, kind, portTouched, stepsTouched]);

  const slug = useMemo(() => slugify(name), [name]);
  const isStatic = kind === 'static';
  const canSubmit = Boolean(repoFullName && branch && slug && (isStatic || nodeVersion));

  // The pipeline differs per type, so switching type discards edits and reloads that type's defaults.
  const chooseKind = (next) => {
    if (next === kind) return;
    setKind(next);
    setStepsTouched(false);
    setSteps([]);
    if (next === 'static') setPort('');
    setPortTouched(false);
  };

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
        nodeVersion: isStatic ? nodeVersion || '20' : nodeVersion,
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

      <Section step={1} title="Project type" description="How this app is run and served.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { value: 'node', icon: Server, title: 'Node server', text: 'Runs under PM2 on its own port; Nginx proxies to it.' },
            { value: 'static', icon: FileCode2, title: 'Static site', text: 'HTML/CSS/JS served directly by Nginx. No process, no port.' },
          ].map(({ value, icon: Icon, title, text }) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseKind(value)}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                kind === value ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-white/60 dark:border-white/10'
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand)]" />
              <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">{title}</span>
                <span className="block text-xs text-[var(--text-muted)]">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section step={2} title="Repository" description="Pick the GitHub repo to deploy.">
        <RepoPicker value={repoFullName} onChange={(v) => { setRepoFullName(v); setBranch(''); }} />
      </Section>

      <Section step={3} title="Branch" description="Which branch this app tracks.">
        <BranchPicker repoFullName={repoFullName} value={branch} onChange={setBranch} />
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

      {isStatic ? null : (
        <Section step={5} title="Node version">
          <NodeVersionPicker repoFullName={repoFullName} branch={branch} value={nodeVersion} onChange={setNodeVersion} />
        </Section>
      )}

      <Section step={6} title="Environment variables">
        <EnvEditor value={env} onChange={setEnv} />
      </Section>

      <Section step={7} title="Deploy steps" description="What runs, in order, on every deploy.">
        {steps.length ? <StepsEditor value={steps} kind={kind} onChange={(v) => { setStepsTouched(true); setSteps(v); }} /> : (
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
