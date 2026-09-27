import { useParams } from 'react-router-dom';
import { AppWindow } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function AppDetail() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      <PageHeader icon={AppWindow} eyebrow="App" title={id}>
        Overview, environment, steps, deployments and runtime logs.
      </PageHeader>
      <EmptyState icon={AppWindow} title="Coming soon" description="App detail tabs and actions will live here." />
    </div>
  );
}
