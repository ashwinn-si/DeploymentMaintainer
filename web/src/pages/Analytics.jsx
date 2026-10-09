import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Loader } from '../components/ui/Loader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useServer } from '../context/ServerContext.jsx';
import { AnalyticsControls } from '../components/analytics/AnalyticsControls.jsx';
import { SummaryTiles } from '../components/analytics/SummaryTiles.jsx';
import { AppsBarCard } from '../components/analytics/AppsBarCard.jsx';
import { TimeSeriesCard } from '../components/analytics/TimeSeriesCard.jsx';
import { StatusMixCard } from '../components/analytics/StatusMixCard.jsx';
import { BusiestHoursCard } from '../components/analytics/BusiestHoursCard.jsx';
import { SetupState } from '../components/analytics/SetupState.jsx';

const POLL_MS = 60000;

function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <ul className="space-y-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      {warnings.map((w, i) => (
        <li key={`${w.app}-${i}`} className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{w.app}</span>: {w.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Analytics() {
  const { api } = useServer();
  const [range, setRange] = useState('24h');
  const [selected, setSelected] = useState([]);
  const [appList, setAppList] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);
  const selectedKey = selected.join(',');

  useEffect(() => {
    let cancelled = false;
    api.apps
      .list()
      .then((res) => !cancelled && setAppList(res.apps.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(async () => {
    const seq = ++requestRef.current;
    try {
      const result = await api.analytics.get(range, selectedKey ? selectedKey.split(',') : []);
      if (seq !== requestRef.current) return;
      setData(result);
      setError('');
    } catch (err) {
      if (seq === requestRef.current) setError(err.message || 'Could not load analytics');
    } finally {
      if (seq === requestRef.current) setLoading(false);
    }
  }, [api, range, selectedKey]);

  // Reloads when the range or app filter changes, then every minute while the tab is visible.
  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      requestRef.current += 1;
    };
  }, [load]);

  const total = useMemo(() => data?.apps.reduce((sum, a) => sum + a.total, 0) ?? 0, [data]);
  const reload = () => {
    setLoading(true);
    load();
  };

  let body;
  if (!data && loading) {
    body = <Loader />;
  } else if (!data) {
    body = (
      <EmptyState
        icon={BarChart3}
        title="Couldn't load analytics"
        description={error}
        action={<Button variant="ghost" onClick={reload}>Retry</Button>}
      />
    );
  } else if (!data.enabled) {
    body = (
      <EmptyState
        icon={BarChart3}
        title="Analytics is disabled"
        description="Analytics is disabled on this server (ANALYTICS_ENABLED=false)."
      />
    );
  } else if (!data.logDirReady || total === 0) {
    body = (
      <>
        <Warnings warnings={data.warnings} />
        {data.logDirReady ? (
          <AnalyticsControls range={range} onRangeChange={setRange} apps={appList} selected={selected} onSelectedChange={setSelected} />
        ) : null}
        <SetupState api={api} logDirReady={data.logDirReady} onDone={reload} />
      </>
    );
  } else {
    body = (
      <>
        <Warnings warnings={data.warnings} />
        <AnalyticsControls range={range} onRangeChange={setRange} apps={appList} selected={selected} onSelectedChange={setSelected} />
        {error ? (
          <p className="text-sm text-rose-500">
            {error}{' '}
            <button type="button" onClick={reload} className="font-semibold underline">
              Retry
            </button>
          </p>
        ) : null}
        <SummaryTiles data={data} />
        <div className={`grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
          <AppsBarCard apps={data.apps} />
          <StatusMixCard status={data.status} />
          <TimeSeriesCard data={data} />
          <BusiestHoursCard busiestHours={data.busiestHours} />
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} eyebrow="This server" title="Analytics">
        Which apps get the most traffic, and when.
      </PageHeader>
      {body}
    </div>
  );
}
