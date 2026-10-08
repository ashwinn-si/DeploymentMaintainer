import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { isMockEnabled } from './dev/mockFlag.js';
import './index.css';

function renderApp() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
            {/* Toaster must live inside BrowserRouter: toast content can include <Link>s
                (e.g. "View log"), which need Router context to render. */}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: 'var(--overlay-bg)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid var(--premium-border)',
                  boxShadow: 'var(--shadow-lifted)',
                  borderRadius: '0.9rem',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                },
                success: { iconTheme: { primary: 'var(--brand)', secondary: 'var(--surface-bg)' } },
                error: { iconTheme: { primary: '#DC2626', secondary: 'var(--surface-bg)' } },
              }}
            />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

// This whole branch is statically eliminated from production builds: `import.meta.env.DEV`
// is a compile-time constant, so the dead branch (and its dynamic import) never bundles.
if (import.meta.env.DEV && isMockEnabled()) {
  import('./dev/mockApi.js').then(({ installMockFetch }) => {
    installMockFetch();
    renderApp();
  });
} else {
  renderApp();
}
