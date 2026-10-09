import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ServerCrash } from 'lucide-react';
import { serversApi, ApiError } from '../api.js';
import { ServerProvider, useServer } from '../context/ServerContext.jsx';
import { useActiveDeployments } from '../hooks/useActiveDeployments.js';
import { AppShell } from '../components/layout/AppShell.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Loader } from '../components/ui/Loader.jsx';

function DeployToastBody({ label, deployment, href }) {
  return (
    <span className="flex items-center gap-2">
      <span>
        {label} · {deployment.appName}
      </span>
      <Link to={href} className="font-semibold text-[var(--brand)] hover:underline">
        View log
      </Link>
    </span>
  );
}

// Everything under /s/:serverId. Active deployments are polled for this server only
// and drive the sidebar dot and the finished-deploy toasts.
function ServerShell() {
  const { server, serverPath } = useServer();

  const handleFinished = useCallback(
    (deployment) => {
      const href = serverPath(`/deployments/${deployment.id}`);
      if (deployment.status === 'success') {
        toast.success(<DeployToastBody label="Deploy succeeded" deployment={deployment} href={href} />, { duration: 6000 });
      } else if (deployment.status === 'failed' || deployment.status === 'cancelled') {
        toast.error(
          <DeployToastBody label={deployment.status === 'failed' ? 'Deploy failed' : 'Deploy cancelled'} deployment={deployment} href={href} />,
          { duration: 6000 }
        );
      }
    },
    [serverPath]
  );

  const { deployments, deploying } = useActiveDeployments({ serverId: server.id, onFinished: handleFinished });

  return <AppShell deploying={deploying} outletContext={{ activeDeployments: deployments }} />;
}

function Centered({ children }) {
  return <div className="flex min-h-dvh items-center justify-center px-4 py-10">{children}</div>;
}

export function ServerLayout() {
  const { serverId } = useParams();
  const [state, setState] = useState({ id: null, server: null, error: null });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ id: serverId, server: null, error: null });
    serversApi
      .get(serverId)
      .then((data) => {
        if (!cancelled) setState({ id: serverId, server: data.server, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ id: serverId, server: null, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  useEffect(() => load(), [load]);

  const current = state.id === serverId ? state : { server: null, error: null };

  if (current.error) {
    const notFound = current.error instanceof ApiError && current.error.status === 404;
    return (
      <Centered>
        <GlassCard variant="strong" className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <ServerCrash className="h-6 w-6" />
          </div>
          <h1 className="mb-2 text-2xl font-medium tracking-tight text-[var(--text-primary)]">
            {notFound ? 'Server not found' : "Couldn't load server"}
          </h1>
          <p className="mb-6 text-sm text-[var(--text-muted)]">
            {notFound ? 'This server is not registered, or it was removed.' : current.error.message}
          </p>
          <div className="flex flex-col gap-2">
            {notFound ? null : <Button onClick={load}>Retry</Button>}
            <Link to="/dashboard">
              <Button variant={notFound ? 'primary' : 'ghost'} className="w-full">
                Back to Servers
              </Button>
            </Link>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  if (!current.server) {
    return (
      <Centered>
        <Loader />
      </Centered>
    );
  }

  return (
    <ServerProvider server={current.server}>
      <ServerShell key={current.server.id} />
    </ServerProvider>
  );
}
