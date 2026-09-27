import { useEffect, useState } from 'react';
import { Rocket, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Button } from '../components/ui/Button.jsx';
import { SelectSheet } from '../components/ui/SelectSheet.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { DeploymentRow } from '../components/DeploymentRow.jsx';
import { appsApi, deploymentsApi } from '../api.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const MODE_OPTIONS = [
  { value: '', label: 'All modes' },
  { value: 'update', label: 'Update' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'rollback', label: 'Rollback' },
];

function FilterFields({ apps, filters, setFilter }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <SelectSheet
        label="App"
        value={filters.app}
        onChange={(v) => setFilter('app', v)}
        options={[{ value: '', label: 'All apps' }, ...apps.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <SelectSheet label="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={STATUS_OPTIONS} />
      <Input label="Branch" value={filters.branch} onChange={(e) => setFilter('branch', e.target.value)} placeholder="Any branch" />
      <SelectSheet label="Mode" value={filters.mode} onChange={(v) => setFilter('mode', v)} options={MODE_OPTIONS} />
    </div>
  );
}

export function Deployments() {
  const [apps, setApps] = useState([]);
  const [filters, setFilters] = useState({ app: '', status: '', branch: '', mode: '' });
  const [deployments, setDeployments] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    appsApi.list().then((data) => setApps(data.apps)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    deploymentsApi
      .list({ app: filters.app, status: filters.status, branch: filters.branch, mode: filters.mode, limit: 25 })
      .then((data) => {
        setDeployments(data.deployments);
        setNextBefore(data.nextBefore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await deploymentsApi.list({ ...filters, before: nextBefore, limit: 25 });
      setDeployments((prev) => [...prev, ...data.deployments]);
      setNextBefore(data.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader icon={Rocket} eyebrow="History" title="Deployments">
        Every deployment across every app, filterable by app, status, branch and mode.
      </PageHeader>

      <div className="hidden sm:block">
        <FilterFields apps={apps} filters={filters} setFilter={setFilter} />
      </div>
      <div className="sm:hidden">
        <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </Button>
        <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" size="sm">
          <FilterFields apps={apps} filters={filters} setFilter={setFilter} />
        </Modal>
      </div>

      {!loading && deployments.length === 0 ? (
        <EmptyState icon={Rocket} title="No deployments" description="Nothing matches these filters yet." />
      ) : (
        <div className="space-y-2">
          {deployments.map((d) => (
            <DeploymentRow key={d.id} deployment={d} showApp />
          ))}
        </div>
      )}

      {nextBefore ? (
        <div className="flex justify-center">
          <Button variant="ghost" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
