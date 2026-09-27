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
                  background: 'var(--glass-strong-bg)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid var(--glass-border)',
                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
                  borderRadius: '16px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                },
                success: { iconTheme: { primary: 'var(--brand)', secondary: 'var(--glass-strong-bg)' } },
                error: { iconTheme: { primary: '#EF4444', secondary: 'var(--glass-strong-bg)' } },
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
