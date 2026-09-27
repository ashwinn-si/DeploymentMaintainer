import { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { onSessionExpired } from './api.js';
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
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Apps />} />
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
