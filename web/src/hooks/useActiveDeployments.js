import { useEffect, useRef, useState } from 'react';
import { serverApi } from '../api.js';

const POLL_MS = 3000;

/**
 * Polls GET /deployments/active of one server every 3s while the tab is visible.
 * Feeds the Sidebar "deploying" dot and the ActivityPanel. Fires `onFinished(deployment)`
 * once per deployment that drops out of the active list, with its final state.
 * Idle (and reset) when `serverId` is falsy or `enabled` is false.
 */
export function useActiveDeployments({ serverId, enabled = true, onFinished } = {}) {
  const [state, setState] = useState({ serverId: null, deployments: [] });
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const active = Boolean(serverId) && enabled;

  useEffect(() => {
    if (!active) {
      setState((prev) => (prev.deployments.length ? { serverId: null, deployments: [] } : prev));
      return undefined;
    }

    const api = serverApi(serverId).deployments;
    let cancelled = false;
    let prev = new Map();
    setState({ serverId, deployments: [] });

    async function poll() {
      try {
        const data = await api.active();
        if (cancelled) return;
        const list = data.deployments ?? [];
        const currentIds = new Set(list.map((d) => d.id));

        for (const [id, prevDep] of prev) {
          if (currentIds.has(id)) continue;
          api
            .get(id)
            .then((res) => onFinishedRef.current?.(res.deployment))
            .catch(() => onFinishedRef.current?.(prevDep));
        }

        prev = new Map(list.map((d) => [d.id, d]));
        setState({ serverId, deployments: list });
      } catch {
        // transient error — keep the last known state, try again next tick
      }
    }

    poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, POLL_MS);
    function onVisibility() {
      if (document.visibilityState === 'visible') poll();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [serverId, active]);

  // Never expose another server's deployments for a render after switching.
  const deployments = active && state.serverId === serverId ? state.deployments : [];
  return { deployments, deploying: deployments.length > 0 };
}
