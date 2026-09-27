import { useCallback, useEffect } from 'react';
import { Routes, Route, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { onSessionExpired } from './api.js';
import { useAuth } from './context/AuthContext.jsx';
import { useActiveDeployments } from './hooks/useActiveDeployments.js';
import { RequireAuth } from './components/RequireAuth.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { Login } from './pages/Login.jsx';
import { Apps } from './pages/Apps.jsx';
import { NewApp } from './pages/NewApp.jsx';
import { AppDetail } from './pages/AppDetail.jsx';
import { Deployments } from './pages/Deployments.jsx';
import { DeploymentDetail } from './pages/DeploymentDetail.jsx';
import { Ports } from './pages/Ports.jsx';
import { Server } from './pages/Server.jsx';
import { Settings } from './pages/Settings.jsx';
import { NotFound } from './pages/NotFound.jsx';

function DeployToastBody({ label, deployment }) {
  return (
    <span className="flex items-center gap-2">
      <span>
        {label} · {deployment.appName}
      </span>
      <Link to={`/deployments/${deployment.id}`} className="font-semibold text-[var(--brand)] hover:underline">
        View log
      </Link>
    </span>
  );
}

export default function App() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(
    () =>
      onSessionExpired(() => {
        toast.error('Your session expired. Please sign in again.');
        navigate('/login', { replace: true });
      }),
    [navigate]
  );

  const handleFinished = useCallback((deployment) => {
    if (deployment.status === 'success') {
      toast.success(<DeployToastBody label="Deploy succeeded" deployment={deployment} />, { duration: 6000 });
    } else if (deployment.status === 'failed' || deployment.status === 'cancelled') {
      toast.error(<DeployToastBody label={deployment.status === 'failed' ? 'Deploy failed' : 'Deploy cancelled'} deployment={deployment} />, {
        duration: 6000,
      });
    }
  }, []);

  const { deployments: activeDeployments, deploying } = useActiveDeployments({ enabled: Boolean(user), onFinished: handleFinished });

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell deploying={deploying} />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Apps activeDeployments={activeDeployments} />} />
        <Route path="/new" element={<NewApp />} />
        <Route path="/apps/:id" element={<AppDetail />} />
        <Route path="/deployments" element={<Deployments />} />
        <Route path="/deployments/:id" element={<DeploymentDetail />} />
        <Route path="/ports" element={<Ports />} />
        <Route path="/server" element={<Server />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
