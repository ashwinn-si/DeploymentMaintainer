import { Rocket } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function Deployments() {
  return (
    <div className="space-y-6">
      <PageHeader icon={Rocket} eyebrow="History" title="Deployments">
        Every deployment across every app, filterable by app, status, branch and mode.
      </PageHeader>
      <EmptyState icon={Rocket} title="Coming soon" description="The deployments table will live here." />
    </div>
  );
}
