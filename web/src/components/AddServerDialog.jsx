import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Modal } from './ui/Modal.jsx';
import { Button } from './ui/Button.jsx';
import { Input } from './ui/Input.jsx';
import { Toggle } from './ui/Toggle.jsx';
import { Loader } from './ui/Loader.jsx';
import { serversApi, ApiError } from '../api.js';

const SERVER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const URL_RE = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/i;

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function generateId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret() {
  const b64 = btoa(String.fromCharCode(...randomBytes(32)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePair() {
  return { id: generateId(), secret: generateSecret() };
}

function StepIndicator({ labels, current }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {labels.map((label, i) => {
        const active = i + 1 === current;
        const done = i + 1 < current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold',
                active || done ? 'bg-[var(--brand)] text-white' : 'bg-black/5 text-[var(--text-muted)] dark:bg-white/10',
              ].join(' ')}
            >
              {i + 1}
            </span>
            <span className={active ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
            {i < labels.length - 1 ? <span className="h-px w-4 bg-black/10 dark:bg-white/10" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Add-server wizard (mode "add") or secret rotation (mode "rotate", pass `server`).
 * Secrets live only in this component's state and are cleared whenever the dialog closes.
 */
export function AddServerDialog({ open, onClose, mode = 'add', server = null, onDone }) {
  const rotate = mode === 'rotate';
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [existing, setExisting] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [custom, setCustom] = useState({ id: '', secret: '' });
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const runRef = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Depends on `open` / `rotate` only; callbacks go through refs (see Modal.jsx for why).
  useEffect(() => {
    runRef.current += 1;
    setVerifying(false);
    setError(null);
    setSuccess(false);
    if (!open) {
      setName('');
      setUrl('');
      setExisting(false);
      setGenerated(null);
      setCustom({ id: '', secret: '' });
      return;
    }
    setStep(rotate ? 2 : 1);
    setGenerated(generatePair());
  }, [open, rotate]);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 60;
  const urlValid = URL_RE.test(trimmedUrl);
  const customId = custom.id.trim();
  const customSecret = custom.secret.trim();
  const customIdValid = SERVER_ID_RE.test(customId);
  const customSecretValid = customSecret.length >= 32;

  const useCustom = existing && !rotate;
  const serverId = rotate ? server?.serverId ?? '' : useCustom ? customId : generated?.id ?? '';
  const secret = useCustom ? customSecret : generated?.secret ?? '';
  const configValid = rotate ? Boolean(secret) : useCustom ? customIdValid && customSecretValid : Boolean(generated);

  const snippet = rotate ? `SERVER_SECRET=${secret}` : `SERVER_ID=${serverId}\nSERVER_SECRET=${secret}`;
  const stepLabels = rotate ? ['Configure', 'Verify'] : ['Details', 'Configure', 'Verify'];
  const shownStep = rotate ? step - 1 : step;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — select the text and copy it manually');
    }
  };

  const handleVerify = async () => {
    const run = ++runRef.current;
    setStep(3);
    setError(null);
    setVerifying(true);
    try {
      const { server: saved } = rotate
        ? await serversApi.rotateSecret(server.id, secret)
        : await serversApi.create({ name: trimmedName, url: trimmedUrl, serverId, secret });
      if (run !== runRef.current) return;
      setSuccess(true);
      toast.success(rotate ? `Secret rotated for ${saved.name}` : `${saved.name} added`);
      await onDoneRef.current?.(saved);
      if (run === runRef.current) onCloseRef.current?.();
    } catch (err) {
      if (run !== runRef.current) return;
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      if (run === runRef.current) setVerifying(false);
    }
  };

  const title = rotate ? `Rotate secret${server ? ` · ${server.name}` : ''}` : 'Add server';

  let footer;
  if (step === 1) {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => setStep(2)} disabled={!nameValid || !urlValid}>
          Next
        </Button>
      </>
    );
  } else if (step === 2) {
    footer = (
      <>
        {rotate ? (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setStep(1)}>
            Back
          </Button>
        )}
        <Button onClick={handleVerify} disabled={!configValid}>
          {rotate ? "I've updated the server — Verify" : 'Verify & add'}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep(2)} disabled={verifying || success}>
          Back
        </Button>
        {error ? <Button onClick={handleVerify}>Retry</Button> : null}
      </>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      <StepIndicator labels={stepLabels} current={shownStep} />

      {step === 1 ? (
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" maxLength={60} autoComplete="off" />
          <Input
            label="URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com"
            autoComplete="off"
            inputMode="url"
            error={trimmedUrl && !urlValid ? 'Must start with https:// (or http://localhost for local testing)' : undefined}
            hint="The address of the server's agent, as reachable from the dashboard host."
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          {rotate ? (
            <p className="text-sm">
              The server keeps accepting its current secret until you swap it. Put the new value in its <code>.env</code>, reload it, then
              verify.
            </p>
          ) : (
            <Toggle checked={existing} onChange={setExisting} label="I already have an ID and secret" />
          )}

          {useCustom ? (
            <div className="space-y-4">
              <Input
                label="Server ID"
                value={custom.id}
                onChange={(e) => setCustom((c) => ({ ...c, id: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                error={customId && !customIdValid ? '8–64 characters: letters, digits, - or _' : undefined}
                hint="SERVER_ID from the server's .env"
              />
              <Input
                label="Server secret"
                type="password"
                value={custom.secret}
                onChange={(e) => setCustom((c) => ({ ...c, secret: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                error={customSecret && !customSecretValid ? 'At least 32 characters' : undefined}
                hint="SERVER_SECRET from the server's .env"
              />
              <p className="text-sm">The server must already be running with these values. Nothing is generated or changed on it.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rotate ? (
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Server ID (unchanged)</span>
                  <p className="break-all font-mono text-sm text-[var(--text-primary)]">{serverId}</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {rotate ? 'New SERVER_SECRET' : 'Add to the server'}
                </span>
                <pre className="custom-scrollbar overflow-x-auto whitespace-pre-wrap break-all rounded-2xl border border-[var(--premium-border)] bg-black/[0.03] p-3 font-mono text-xs leading-relaxed text-[var(--text-primary)] dark:bg-black/40">
                  {snippet}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={handleCopy}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGenerated(rotate ? { ...generated, secret: generateSecret() } : generatePair())}>
                    <RefreshCw className="h-4 w-4" />
                    Generate new
                  </Button>
                </div>
              </div>
              <p className="text-sm">
                Add {rotate ? 'this line' : 'these lines'} to <code>server/.env</code> on that server (replace any existing{' '}
                {rotate ? 'SERVER_SECRET' : 'SERVER_ID / SERVER_SECRET'}), then run <code>pm2 reload deployment-maintainer</code>.
              </p>
              <p className="text-xs text-[var(--text-muted)]">The secret is shown only here. It is not stored until the server verifies it.</p>
            </div>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          {verifying ? (
            <Loader label={`Contacting ${rotate ? server?.url : trimmedUrl}`} />
          ) : success ? (
            <p className="flex items-center gap-2 text-sm text-teal-600 dark:text-teal-400">
              <CheckCircle2 className="h-4 w-4" />
              Verified.
            </p>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
