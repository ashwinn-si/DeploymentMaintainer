import { LayoutGrid } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function Apps() {
  return (
    <div className="space-y-6">
      <PageHeader icon={LayoutGrid} eyebrow="Dashboard" title="Apps">
        Your deployed applications, at a glance.
      </PageHeader>
      <EmptyState icon={LayoutGrid} title="Coming soon" description="The app grid, server health card and activity panel will live here." />
    </div>
  );
}
