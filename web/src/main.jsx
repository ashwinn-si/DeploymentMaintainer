import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
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
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
