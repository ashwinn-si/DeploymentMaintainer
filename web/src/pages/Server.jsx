import { Server as ServerIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function Server() {
  return (
    <div className="space-y-6">
      <PageHeader icon={ServerIcon} eyebrow="Health" title="Server">
        CPU, RAM, disk and per-app resource usage.
      </PageHeader>
      <EmptyState icon={ServerIcon} title="Coming soon" description="Server health rings and the per-app table will live here." />
    </div>
  );
}
