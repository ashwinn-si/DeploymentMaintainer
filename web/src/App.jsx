import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { onSessionExpired } from './api.js';
import { RequireAuth } from './components/RequireAuth.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { Loader } from './components/ui/Loader.jsx';
import { ServersProvider } from './context/ServersContext.jsx';
import { Login } from './pages/Login.jsx';
import { Servers } from './pages/Servers.jsx';
import { ServerLayout } from './pages/ServerLayout.jsx';
import { Apps } from './pages/Apps.jsx';
import { NotFound } from './pages/NotFound.jsx';

// Route-split everything past the home pages: keeps the initial bundle under
// Vite's 500KB chunk warning and means a first paint doesn't pay for the
// steps editor, log viewer, rings/sparklines, etc. until they're visited.
const Account = lazy(() => import('./pages/Account.jsx').then((m) => ({ default: m.Account })));
const NewApp = lazy(() => import('./pages/NewApp.jsx').then((m) => ({ default: m.NewApp })));
const AppDetail = lazy(() => import('./pages/AppDetail.jsx').then((m) => ({ default: m.AppDetail })));
const Deployments = lazy(() => import('./pages/Deployments.jsx').then((m) => ({ default: m.Deployments })));
const DeploymentDetail = lazy(() => import('./pages/DeploymentDetail.jsx').then((m) => ({ default: m.DeploymentDetail })));
const Ports = lazy(() => import('./pages/Ports.jsx').then((m) => ({ default: m.Ports })));
const Server = lazy(() => import('./pages/Server.jsx').then((m) => ({ default: m.Server })));
const ServerSettings = lazy(() => import('./pages/ServerSettings.jsx').then((m) => ({ default: m.ServerSettings })));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader />
    </div>
  );
}

function Lazy({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export default function App() {
  const navigate = useNavigate();

  useEffect(
    () =>
      onSessionExpired(() => {
        toast.error('Your session expired. Please sign in again.');
        navigate('/login', { replace: true });
      }),
    [navigate]
  );

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <ServersProvider>
              <Outlet />
            </ServersProvider>
          </RequireAuth>
        }
      >
        <Route element={<AppShell />}>
          <Route path="/" element={<Servers />} />
          <Route
            path="/settings"
            element={
              <Lazy>
                <Account />
              </Lazy>
            }
          />
        </Route>

        <Route path="/s/:serverId" element={<ServerLayout />}>
          <Route index element={<Apps />} />
          <Route
            path="new"
            element={
              <Lazy>
                <NewApp />
              </Lazy>
            }
          />
          <Route
            path="apps/:id"
            element={
              <Lazy>
                <AppDetail />
              </Lazy>
            }
          />
          <Route
            path="deployments"
            element={
              <Lazy>
                <Deployments />
              </Lazy>
            }
          />
          <Route
            path="deployments/:id"
            element={
              <Lazy>
                <DeploymentDetail />
              </Lazy>
            }
          />
          <Route
            path="ports"
            element={
              <Lazy>
                <Ports />
              </Lazy>
            }
          />
          <Route
            path="server"
            element={
              <Lazy>
                <Server />
              </Lazy>
            }
          />
          <Route
            path="settings"
            element={
              <Lazy>
                <ServerSettings />
              </Lazy>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
