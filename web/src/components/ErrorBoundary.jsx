import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Last line of defence: a render error in one page shows this card instead of a blank screen.
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Navigating away clears the error so the rest of the app stays usable.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="surface-overlay w-full max-w-md rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Something went wrong</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This page hit an unexpected error. Your data is safe. Reload to try again.
          </p>
          <pre className="custom-scrollbar mt-4 max-h-24 overflow-auto rounded-xl bg-base-200 p-3 text-left font-mono text-[11px] text-[var(--text-secondary)]">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => window.location.reload()} className="btn-base btn-primary-cta inline-flex items-center justify-center gap-2 px-5">
              <RefreshCw className="h-4 w-4" /> Reload page
            </button>
            <a href="/" className="btn-base btn-quiet inline-flex items-center justify-center px-5">Go home</a>
          </div>
        </div>
      </div>
    );
  }
}
