import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Modal } from './ui/Modal.jsx';
import { Button } from './ui/Button.jsx';
import { Input } from './ui/Input.jsx';
import { Toggle } from './ui/Toggle.jsx';
import { BranchPicker } from './BranchPicker.jsx';
import { NodeVersionPicker } from './NodeVersionPicker.jsx';
import { appsApi, ApiError } from '../api.js';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function DuplicateDialog({ open, onClose, app }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [port, setPort] = useState('');
  const [nodeVersion, setNodeVersion] = useState('');
  const [copyEnv, setCopyEnv] = useState(true);
  const [deployNow, setDeployNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && app) {
      setName(`${app.name}-copy`);
      setBranch(app.branch);
      setPort('');
      setNodeVersion(app.nodeVersion);
      setCopyEnv(true);
      setDeployNow(false);
      setError(null);
    }
  }, [open, app]);

  if (!app) return null;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const { app: created, deployment } = await appsApi.duplicate(app.id, {
        name: slugify(name),
        branch,
        port: port ? Number(port) : undefined,
        nodeVersion,
        copyEnv,
        deploy: deployNow,
      });
      onClose();
      toast.success(`${created.name} created`);
      navigate(deployNow && deployment ? `/deployments/${deployment.id}` : `/apps/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to duplicate app');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Duplicate ${app.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={loading} disabled={!slugify(name) || !branch}>
            Create{deployNow ? ' & Deploy' : ''}
          </Button>
        </>
      }
    >
      <Input label="New app name" value={name} onChange={(e) => setName(e.target.value)} hint={slugify(name) ? `Slug: ${slugify(name)}` : undefined} />
      <BranchPicker repoFullName={app.repoFullName} value={branch} onChange={setBranch} />
      <Input label="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="Auto-assigned" />
      <NodeVersionPicker repoFullName={app.repoFullName} branch={branch} value={nodeVersion} onChange={setNodeVersion} />
      <Toggle checked={copyEnv} onChange={setCopyEnv} label="Copy environment variables" />
      <Toggle checked={deployNow} onChange={setDeployNow} label="Deploy immediately" />
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
    </Modal>
  );
}
