import { useEffect, useState } from 'react';
import { SelectSheet } from './ui/SelectSheet.jsx';
import { useServer } from '../context/ServerContext.jsx';

export function BranchPicker({ repoFullName, value, onChange, label = 'Branch' }) {
  const { api } = useServer();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repoFullName) {
      setBranches([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const [owner, repo] = repoFullName.split('/');
    api.repos
      .branches(owner, repo)
      .then((data) => {
        if (cancelled) return;
        setBranches(data.branches ?? []);
        const list = data.branches ?? [];
        // Prefer main, then master, then the repo's default (the API lists it first).
        const preferred = ['main', 'master'].find((b) => list.includes(b)) ?? list[0];
        if (!value && preferred) onChange(preferred);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only re-runs on repo change — see Modal.jsx for why effects
    // shouldn't depend on inline callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName]);

  return (
    <SelectSheet
      label={label}
      value={value}
      onChange={onChange}
      options={branches.map((b) => ({ value: b, label: b }))}
      placeholder={loading ? 'Loading branches…' : repoFullName ? 'Select a branch' : 'Pick a repo first'}
      searchable={branches.length > 8}
    />
  );
}
