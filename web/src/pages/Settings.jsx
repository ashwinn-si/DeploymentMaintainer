import { Settings as SettingsIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export function Settings() {
  return (
    <div className="space-y-6">
      <PageHeader icon={SettingsIcon} eyebrow="Account" title="Settings">
        Password, config export/import and read-only server info.
      </PageHeader>
      <EmptyState icon={SettingsIcon} title="Coming soon" description="Change password and config import/export will live here." />
    </div>
  );
}
