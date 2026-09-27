import { PlusCircle } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function NewApp() {
  return (
    <div className="space-y-6">
      <PageHeader icon={PlusCircle} eyebrow="Deploy" title="New App">
        Pick a repo, configure the pipeline, and deploy.
      </PageHeader>
      <EmptyState icon={PlusCircle} title="Coming soon" description="Repo picker, branch picker, env editor and steps editor will live here." />
    </div>
  );
}
