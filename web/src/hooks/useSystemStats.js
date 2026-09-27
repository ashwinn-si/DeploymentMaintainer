import { useEffect, useState } from 'react';
import { systemApi } from '../api.js';

const POLL_MS = 10000;

// Module-level singleton: every component that calls useSystemStats() shares
// one GET /system poll instead of each mounting its own interval. The poll
// starts when the first subscriber mounts and stops when the last unmounts.
let cache = { system: null, error: null };
const subscribers = new Set();
let timer = null;
let inFlight = null;

function notify() {
  for (const fn of subscribers) fn(cache);
}

function poll() {
  if (inFlight) return inFlight;
  inFlight = systemApi
    .get()
    .then((data) => {
      cache = { system: data, error: null };
    })
    .catch((err) => {
      cache = { ...cache, error: err };
    })
    .finally(() => {
      inFlight = null;
      notify();
    });
  return inFlight;
}

function ensurePolling() {
  if (timer) return;
  poll();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') poll();
  }, POLL_MS);
}

function stopPollingIfIdle() {
  if (subscribers.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function useSystemStats() {
  const [state, setState] = useState(cache);

  useEffect(() => {
    subscribers.add(setState);
    ensurePolling();
    // Resync in case the cache changed between render and effect (e.g. StrictMode double-invoke).
    setState(cache);
    return () => {
      subscribers.delete(setState);
      stopPollingIfIdle();
    };
  }, []);

  return state;
}
