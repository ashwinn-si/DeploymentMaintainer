import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Settings as SettingsIcon, Github, DownloadCloud, UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Toggle } from '../components/ui/Toggle.jsx';
import { StatusPill } from '../components/ui/StatusPill.jsx';
import { ApiError } from '../api.js';
import { downloadFile } from '../lib/download.js';
import { useServer } from '../context/ServerContext.jsx';

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <GlassCard variant="mid">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="text-xs text-[var(--text-muted)]">{description}</p> : null}
        </div>
      </div>
      {children}
    </GlassCard>
  );
}

function GithubInfoCard() {
  const { api } = useServer();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.settings
      .info()
      .then(setInfo)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load server info'));
  }, [api]);

  return (
    <SectionCard icon={Github} title="GitHub & server info" description="Read-only — configured in the server's .env.">
      {error ? (
        <p className="text-sm text-rose-500">{error}</p>
      ) : !info ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : (
        <div className="space-y-4">
          {info.github?.error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>GitHub token missing or invalid: {info.github.error}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Token owner</p>
                <p className="text-sm text-[var(--text-primary)]">{info.github?.login}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Rate limit remaining</p>
                <p className="text-sm text-[var(--text-primary)]">{info.github?.rateLimitRemaining}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Scopes</p>
                {info.github?.scopes?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {info.github.scopes.map((s) => (
                      <StatusPill key={s} tone="neutral">
                        {s}
                      </StatusPill>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    No scopes reported — fine-grained tokens don't expose scopes via the API, this is expected.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 border-t border-[var(--premium-border)] pt-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Apps directory</p>
              <p className="font-mono text-xs text-[var(--text-primary)]">{info.appsDir}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Nginx routing</p>
              <StatusPill tone={info.nginxEnabled ? 'teal' : 'amber'}>{info.nginxEnabled ? 'enabled' : 'disabled'}</StatusPill>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Domain</p>
              <p className="text-sm text-[var(--text-primary)]">{info.domainHint ?? 'not set'}</p>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function ExportPanel() {
  const { api } = useServer();
  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.apps
      .list()
      .then((data) => {
        setApps(data.apps);
        setSelected(new Set(data.apps.map((a) => a.id)));
      })
      .catch(() => {});
  }, [api]);

  const toggleApp = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canExport = selected.size > 0 && passphrase.length >= 8 && passphrase === confirm;

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile(api.config.exportUrl, {
        method: 'POST',
        body: { appIds: [...selected], passphrase },
        fallbackFilename: `deployer-config-${new Date().toISOString().slice(0, 10)}.json`,
        errorMessage: 'Export failed',
      });
      toast.success('Config exported');
      setPassphrase('');
      setConfirm('');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Apps to include</p>
        {apps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No apps yet.</p>
        ) : (
          <div className="flex flex-col items-start gap-2.5">
            {apps.map((app) => (
              <Toggle key={app.id} checked={selected.has(app.id)} onChange={() => toggleApp(app.id)} label={app.name} />
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} hint="At least 8 characters" />
        <Input
          label="Confirm passphrase"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== passphrase ? "Doesn't match" : undefined}
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" loading={exporting} disabled={!canExport} onClick={handleExport}>
          <DownloadCloud className="h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );
}

function ImportPanel() {
  const { api, serverPath } = useServer();
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [previewRows, setPreviewRows] = useState(null);
  const [rowActions, setRowActions] = useState({});
  const [deployAfter, setDeployAfter] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    const picked = e.target.files?.[0];
    setPreviewRows(null);
    setResult(null);
    if (!picked) return;
    setFileName(picked.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setFile(JSON.parse(String(reader.result)));
      } catch {
        toast.error('That file is not valid JSON');
        setFile(null);
      }
    };
    reader.readAsText(picked);
  };

  const handlePreview = async () => {
    if (!file) {
      toast.error('Choose an export file first');
      return;
    }
    setPreviewing(true);
    try {
      const data = await api.config.importPreview({ file, passphrase });
      setPreviewRows(data.rows);
      setResult(null);
      const actions = {};
      for (const row of data.rows) {
        actions[row.name] = { action: row.conflict === 'name' ? 'skip' : 'create', newName: row.suggestedName ?? '' };
      }
      setRowActions(actions);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Preview failed — check the passphrase');
    } finally {
      setPreviewing(false);
    }
  };

  const setRowAction = (name, patch) => setRowActions((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));

  const handleImport = async () => {
    setImporting(true);
    try {
      const rows = previewRows.map((row) => ({
        name: row.name,
        action: rowActions[row.name]?.action ?? 'skip',
        newName: rowActions[row.name]?.newName || undefined,
      }));
      const data = await api.config.importApply({ file, passphrase, rows, deploy: deployAfter });
      setResult(data);
      toast.success(`${data.created.length} app${data.created.length === 1 ? '' : 's'} imported`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-[var(--premium-border)] pt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Export file</label>
          <label className="surface-inset flex min-h-[44px] cursor-pointer items-center justify-center rounded-2xl border border-dashed border-[var(--premium-border)] px-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            {fileName || 'Choose a .json file'}
            <input type="file" accept="application/json,.json" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
        <Input label="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" loading={previewing} disabled={!file || passphrase.length < 8} onClick={handlePreview}>
          Preview
        </Button>
      </div>

      {previewRows ? (
        <div className="space-y-3">
          {previewRows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">The file has no apps.</p>
          ) : (
            previewRows.map((row) => {
              const rowState = rowActions[row.name] ?? { action: 'create' };
              return (
                <div key={row.name} className="surface-inset space-y-2 rounded-2xl border border-[var(--premium-border)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{row.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {row.repoFullName} @ {row.branch}{row.rootDir ? ` · /${row.rootDir}` : ''} · port {row.port}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.conflict ? (
                        <StatusPill tone="rose">{row.conflict === 'name' ? 'name conflict' : 'port conflict'}</StatusPill>
                      ) : (
                        <StatusPill tone="teal">no conflict</StatusPill>
                      )}
                      <button
                        type="button"
                        onClick={() => setRowAction(row.name, { action: rowState.action === 'create' ? 'skip' : 'create' })}
                        className={[
                          'min-h-[38px] rounded-full px-3 text-xs font-medium transition-colors',
                          rowState.action === 'create' ? 'bg-[var(--brand)] text-white' : 'surface-inset text-[var(--text-muted)]',
                        ].join(' ')}
                      >
                        {rowState.action === 'create' ? 'Create' : 'Skip'}
                      </button>
                    </div>
                  </div>
                  {row.conflict === 'name' && rowState.action === 'create' ? (
                    <Input
                      label="New name"
                      value={rowState.newName ?? ''}
                      onChange={(e) => setRowAction(row.name, { newName: e.target.value })}
                    />
                  ) : null}
                </div>
              );
            })
          )}

          <Toggle checked={deployAfter} onChange={setDeployAfter} label="Deploy after import" />

          <div className="flex justify-end">
            <Button size="sm" loading={importing} disabled={previewRows.length === 0} onClick={handleImport}>
              <UploadCloud className="h-4 w-4" />
              Import
            </Button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="flex items-start gap-2 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-3 text-sm text-teal-700 dark:text-teal-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>{result.created.length} app(s) created{deployAfter ? ', deploying now' : ''}.</p>
            <div className="flex flex-wrap gap-2">
              {result.created.map((app) => (
                <Link key={app.id} to={serverPath(`/apps/${app.id}`)} className="font-medium text-[var(--brand)] hover:underline">
                  {app.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackupCard() {
  return (
    <SectionCard icon={DownloadCloud} title="Backup" description="Export apps to a passphrase-encrypted file, or restore from one.">
      <div className="space-y-6">
        <ExportPanel />
        <ImportPanel />
        <p className="flex items-start gap-2 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
          <span>
            <code>npm run clear-db</code> only drops the database — it doesn't stop PM2 processes, remove app folders or touch Nginx
            config. Export first if you want a way back.
          </span>
        </p>
      </div>
    </SectionCard>
  );
}

export function ServerSettings() {
  return (
    <div className="space-y-6">
      <PageHeader icon={SettingsIcon} eyebrow="This server" title="Server settings">
        Config export/import and read-only server info.
      </PageHeader>
      <GithubInfoCard />
      <BackupCard />
    </div>
  );
}
