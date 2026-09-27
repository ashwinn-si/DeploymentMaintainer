import { Plug } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function Ports() {
  return (
    <div className="space-y-6">
      <PageHeader icon={Plug} eyebrow="Network" title="Ports">
        Port allocation, path routing and conflicts across every app.
      </PageHeader>
      <EmptyState icon={Plug} title="Coming soon" description="The ports table will live here." />
    </div>
  );
}
