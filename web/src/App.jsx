import { Suspense, lazy, useCallback, useEffect } from 'react';
import { Routes, Route, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { onSessionExpired } from './api.js';
import { useAuth } from './context/AuthContext.jsx';
import { useActiveDeployments } from './hooks/useActiveDeployments.js';
import { RequireAuth } from './components/RequireAuth.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { Loader } from './components/ui/Loader.jsx';
import { Login } from './pages/Login.jsx';
import { Apps } from './pages/Apps.jsx';
import { NotFound } from './pages/NotFound.jsx';

// Route-split everything past the home page: keeps the initial bundle under
// Vite's 500KB chunk warning and means a first paint doesn't pay for the
// steps editor, log viewer, rings/sparklines, etc. until they're visited.
const NewApp = lazy(() => import('./pages/NewApp.jsx').then((m) => ({ default: m.NewApp })));
const AppDetail = lazy(() => import('./pages/AppDetail.jsx').then((m) => ({ default: m.AppDetail })));
const Deployments = lazy(() => import('./pages/Deployments.jsx').then((m) => ({ default: m.Deployments })));
const DeploymentDetail = lazy(() => import('./pages/DeploymentDetail.jsx').then((m) => ({ default: m.DeploymentDetail })));
const Ports = lazy(() => import('./pages/Ports.jsx').then((m) => ({ default: m.Ports })));
const Server = lazy(() => import('./pages/Server.jsx').then((m) => ({ default: m.Server })));
const Settings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.Settings })));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader />
    </div>
  );
}

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
        <Route
          path="/new"
          element={
            <Suspense fallback={<PageFallback />}>
              <NewApp />
            </Suspense>
          }
        />
        <Route
          path="/apps/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <AppDetail />
            </Suspense>
          }
        />
        <Route
          path="/deployments"
          element={
            <Suspense fallback={<PageFallback />}>
              <Deployments />
            </Suspense>
          }
        />
        <Route
          path="/deployments/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeploymentDetail />
            </Suspense>
          }
        />
        <Route
          path="/ports"
          element={
            <Suspense fallback={<PageFallback />}>
              <Ports />
            </Suspense>
          }
        />
        <Route
          path="/server"
          element={
            <Suspense fallback={<PageFallback />}>
              <Server />
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <Settings />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
