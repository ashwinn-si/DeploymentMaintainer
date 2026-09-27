import { useCallback, useEffect, useRef, useState } from 'react';
import { deploymentsApi } from '../api.js';

const POLL_MS = 3000;

/**
 * Polls GET /deployments/active every 3s while the tab is visible. Feeds the
 * Sidebar "deploying" dot and the ActivityPanel. Fires `onFinished(deployment)`
 * once per deployment that drops out of the active list, with its final state.
 */
export function useActiveDeployments({ enabled = true, onFinished } = {}) {
  const [deployments, setDeployments] = useState([]);
  const prevRef = useRef(new Map());
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const timerRef = useRef(null);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await deploymentsApi.active();
      const list = data.deployments ?? [];
      const currentIds = new Set(list.map((d) => d.id));

      for (const [id, prevDep] of prevRef.current) {
        if (currentIds.has(id)) continue;
        deploymentsApi
          .get(id)
          .then((res) => onFinishedRef.current?.(res.deployment))
          .catch(() => onFinishedRef.current?.(prevDep));
      }

      prevRef.current = new Map(list.map((d) => [d.id, d]));
      setDeployments(list);
    } catch {
      // transient error — keep the last known state, try again next tick
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setDeployments([]);
      prevRef.current = new Map();
      return undefined;
    }
    poll();
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, POLL_MS);

    function onVisibility() {
      if (document.visibilityState === 'visible') poll();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, enabled]);

  return { deployments, deploying: deployments.length > 0 };
}
