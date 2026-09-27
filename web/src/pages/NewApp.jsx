import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PlusCircle } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { RepoPicker } from '../components/RepoPicker.jsx';
import { BranchPicker } from '../components/BranchPicker.jsx';
import { NodeVersionPicker } from '../components/NodeVersionPicker.jsx';
import { EnvEditor } from '../components/EnvEditor.jsx';
import { StepsEditor } from '../components/StepsEditor.jsx';
import { appsApi, ApiError } from '../api.js';

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
  const [repoFullName, setRepoFullName] = useState('');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [port, setPort] = useState('');
  const [portTouched, setPortTouched] = useState(false);
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
      appsApi
        .defaults(slug)
        .then((data) => {
          if (!portTouched && data.port) setPort(String(data.port));
          if (!stepsTouched && data.steps) setSteps(data.steps);
          defaultsRequested.current = true;
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [name, portTouched, stepsTouched]);

  const slug = useMemo(() => slugify(name), [name]);
  const canSubmit = Boolean(repoFullName && branch && slug && nodeVersion);

  const submit = async (deploy) => {
    setSubmitting(deploy ? 'deploy' : 'create');
    setFormError(null);
    setFieldErrors({});
    try {
      const { app, deployment } = await appsApi.create({
        name: slug,
        repoFullName,
        branch,
        port: port ? Number(port) : undefined,
        nodeVersion,
        env,
        steps,
        deploy,
      });
      toast.success(`${app.name} created${deploy ? ' — deploying' : ''}`);
      navigate(deploy && deployment ? `/deployments/${deployment.id}` : `/apps/${app.id}`);
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
        <RepoPicker value={repoFullName} onChange={(v) => { setRepoFullName(v); setBranch(''); }} />
      </Section>

      <Section step={2} title="Branch" description="Which branch this app tracks.">
        <BranchPicker repoFullName={repoFullName} value={branch} onChange={setBranch} />
      </Section>

      <Section step={3} title="Name & port" description="The name becomes the folder name and, if routed, the URL path.">
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
          <Input
            label="Port"
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
      </Section>

      <Section step={4} title="Node version">
        <NodeVersionPicker repoFullName={repoFullName} branch={branch} value={nodeVersion} onChange={setNodeVersion} />
      </Section>

      <Section step={5} title="Environment variables">
        <EnvEditor value={env} onChange={setEnv} />
      </Section>

      <Section step={6} title="Deploy steps" description="What runs, in order, on every deploy.">
        {steps.length ? <StepsEditor value={steps} onChange={(v) => { setStepsTouched(true); setSteps(v); }} /> : (
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
