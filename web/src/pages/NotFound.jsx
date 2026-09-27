import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Button } from '../components/ui/Button.jsx';

export function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <GlassCard variant="strong" className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Compass className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-2xl font-medium tracking-tight text-[var(--text-primary)]">Page not found</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">The page you're looking for doesn't exist.</p>
        <Link to="/">
          <Button className="w-full">Back to Apps</Button>
        </Link>
      </GlassCard>
    </div>
  );
}
