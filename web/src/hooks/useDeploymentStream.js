import { useCallback, useEffect, useRef, useState } from 'react';
import { deploymentsApi } from '../api.js';
import { isMockEnabled } from '../dev/mockFlag.js';

/**
 * Live view of a single deployment: initial state via GET /deployments/:id,
 * then an SSE stream for `line` / `step` / `status` / `done`. Reconnects itself
 * with the last-seen entry index on error (browser auto-reconnect can't do this
 * because it always reopens the original URL) and de-dupes entries by index.
 */
export function useDeploymentStream(id) {
  const [deployment, setDeployment] = useState(null);
  const [entries, setEntries] = useState([]);
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const esRef = useRef(null);
  const lastIndexRef = useRef(-1);
  const doneRef = useRef(false);
  const retryRef = useRef(0);
  const seenRef = useRef(new Set());
  const reconnectTimerRef = useRef(null);
  const pendingRef = useRef([]);
  const frameRef = useRef(null);

  // Batched per animation frame: replaying thousands of lines one setState each would freeze the page.
  const flushPending = useCallback(() => {
    frameRef.current = null;
    const batch = pendingRef.current;
    pendingRef.current = [];
    if (batch.length === 0) return;
    setEntries((prev) => {
      const merged = prev.concat(batch);
      const ordered = merged.every((e, idx) => idx === 0 || merged[idx - 1].i < e.i);
      return ordered ? merged : merged.sort((a, b) => a.i - b.i);
    });
  }, []);

  const applyLine = useCallback((entry) => {
    if (seenRef.current.has(entry.i)) return;
    seenRef.current.add(entry.i);
    lastIndexRef.current = Math.max(lastIndexRef.current, entry.i);
    pendingRef.current.push(entry);
    if (frameRef.current == null) frameRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  const applyStep = useCallback((update) => {
    setSteps((prev) => prev.map((s) => (s.id === update.id ? { ...s, ...update } : s)));
  }, []);

  const applyStatus = useCallback((payload) => {
    setStatus(payload.status);
    setDeployment((prev) =>
      prev
        ? {
            ...prev,
            status: payload.status,
            error: payload.error ?? prev.error,
            commitSha: payload.commitSha ?? prev.commitSha,
            finishedAt: payload.finishedAt ?? prev.finishedAt,
          }
        : prev
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    seenRef.current = new Set();
    lastIndexRef.current = -1;
    doneRef.current = false;
    retryRef.current = 0;
    pendingRef.current = [];
    setEntries([]);
    setSteps([]);
    setStatus(null);
    setDeployment(null);
    setConnected(false);
    setLoadError(null);

    function attach(es) {
      if (cancelled) {
        es.close?.();
        return;
      }
      esRef.current = es;
      setConnected(true);
      retryRef.current = 0;

      es.addEventListener('line', (e) => applyLine(JSON.parse(e.data)));
      es.addEventListener('step', (e) => applyStep(JSON.parse(e.data)));
      es.addEventListener('status', (e) => applyStatus(JSON.parse(e.data)));
      es.addEventListener('done', (e) => {
        const payload = JSON.parse(e.data);
        doneRef.current = true;
        setStatus(payload.status);
        setConnected(false);
        es.close();
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (cancelled || doneRef.current) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 8000);
        retryRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    }

    function connect() {
      if (cancelled || doneRef.current) return;
      if (import.meta.env.DEV && isMockEnabled()) {
        import('../dev/mockApi.js').then(({ createMockStream }) => {
          if (!cancelled) attach(createMockStream(id, lastIndexRef.current));
        });
      } else {
        attach(new EventSource(deploymentsApi.streamUrl(id, lastIndexRef.current)));
      }
    }

    async function loadInitial() {
      try {
        const data = await deploymentsApi.get(id);
        if (cancelled) return;
        setDeployment(data.deployment);
        setSteps(data.deployment.steps ?? []);
        setStatus(data.deployment.status);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    }

    loadInitial().then(connect);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimerRef.current);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      esRef.current?.close();
    };
  }, [id, applyLine, applyStep, applyStatus]);

  return { deployment, entries, steps, status, connected, loadError };
}
