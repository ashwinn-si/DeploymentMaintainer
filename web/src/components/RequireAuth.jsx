import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loader } from './ui/Loader.jsx';
import { ConnectionLost } from './ConnectionLost.jsx';

export function RequireAuth({ children }) {
  const { user, loading, backendDown, refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader />
      </div>
    );
  }

  // Backend down: don't bounce to the login page, signing in couldn't work either.
  if (!user && backendDown) {
    const retry = async () => {
      setRetrying(true);
      await refresh();
      setRetrying(false);
    };
    return <ConnectionLost onRetry={retry} retrying={retrying} />;
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}
