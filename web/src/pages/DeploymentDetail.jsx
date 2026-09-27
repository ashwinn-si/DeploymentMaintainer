import { useParams } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function DeploymentDetail() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      <PageHeader icon={Rocket} eyebrow="Deployment" title={`#${id}`}>
        Step timeline and live log.
      </PageHeader>
      <EmptyState icon={Rocket} title="Coming soon" description="The step timeline and log viewer will live here." />
    </div>
  );
}
