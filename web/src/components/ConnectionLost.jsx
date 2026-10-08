import { WifiOff, RefreshCw } from 'lucide-react';

// Shown when the dashboard's own backend can't be reached, as opposed to the user being signed out.
export function ConnectionLost({ onRetry, retrying = false, message }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="surface-overlay w-full max-w-md rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600">
          <WifiOff className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Can&apos;t reach the server</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {message ?? 'The dashboard backend isn\'t responding. Make sure it is running, then try again.'}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={onRetry} disabled={retrying} className="btn-base btn-primary-cta inline-flex items-center justify-center gap-2 px-5 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} /> {retrying ? 'Trying…' : 'Try again'}
          </button>
          <a href="/about" className="btn-base btn-quiet inline-flex items-center justify-center px-5">About the project</a>
        </div>
      </div>
    </div>
  );
}
