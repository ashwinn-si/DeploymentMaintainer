import { useState } from 'react';
import toast from 'react-hot-toast';
import { BarChart3, Copy } from 'lucide-react';
import { ApiError } from '../../api.js';
import { Button } from '../ui/Button.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';

const LOG_DIR_COMMAND = 'sudo install -d -o root -g ubuntu -m 2755 /var/log/nginx/deployer';

function CopyCode({ text }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  }
  return (
    <div className="surface-inset flex w-full max-w-xl items-start gap-2 rounded-xl p-3 text-left">
      <code className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--text-primary)]">{text}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

// Shown when there is nothing to chart: either the log directory is missing, or no request has been logged yet.
export function SetupState({ api, logDirReady, onDone }) {
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    try {
      const result = await api.analytics.setup();
      toast.success(`Updated ${result.updated} app route${result.updated === 1 ? '' : 's'}`);
      if (result.errors?.length) {
        toast.error(`${result.errors.length} failed: ${result.errors.map((e) => `${e.app} (${e.message})`).join(', ')}`);
      }
      onDone();
    } catch (err) {
      // 409 carries the server's own "create the log directory first" message.
      toast.error(err instanceof ApiError ? err.message : 'Could not enable request logging');
    } finally {
      setBusy(false);
    }
  }

  return (
    <EmptyState
      icon={BarChart3}
      title={logDirReady ? 'No requests recorded yet' : 'Request logging is not set up'}
      description={
        logDirReady
          ? 'Stats come from Nginx access logs. Nothing has been logged in this period; if you have not enabled request logging for your apps yet, do it now, then give it a minute.'
          : 'Stats come from Nginx access logs. Create the log directory once on the server, then enable request logging:'
      }
      action={
        <div className="flex flex-col items-center gap-4">
          {logDirReady ? null : <CopyCode text={LOG_DIR_COMMAND} />}
          <Button onClick={enable} loading={busy}>
            Enable request logging
          </Button>
        </div>
      }
    />
  );
}
