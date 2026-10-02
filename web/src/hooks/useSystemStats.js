import { useEffect, useState } from 'react';
import { serverApi } from '../api.js';

const POLL_MS = 10000;
const EMPTY = { system: null, error: null };

// One entry per server: every component that calls useSystemStats(serverId)
// shares a single GET /system poll. The poll starts when the first subscriber
// mounts and stops when the last unmounts.
const entries = new Map();

function getEntry(serverId) {
  let entry = entries.get(serverId);
  if (!entry) {
    entry = { cache: EMPTY, subscribers: new Set(), timer: null, inFlight: null };
    entries.set(serverId, entry);
  }
  return entry;
}

function notify(entry) {
  for (const fn of entry.subscribers) fn(entry.cache);
}

function poll(serverId, entry) {
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = serverApi(serverId)
    .system.get()
    .then((data) => {
      entry.cache = { system: data, error: null };
    })
    .catch((err) => {
      entry.cache = { ...entry.cache, error: err };
    })
    .finally(() => {
      entry.inFlight = null;
      notify(entry);
    });
  return entry.inFlight;
}

function ensurePolling(serverId, entry) {
  if (entry.timer) return;
  poll(serverId, entry);
  entry.timer = setInterval(() => {
    if (document.visibilityState === 'visible') poll(serverId, entry);
  }, POLL_MS);
}

function stopPollingIfIdle(serverId, entry) {
  if (entry.subscribers.size === 0 && entry.timer) {
    clearInterval(entry.timer);
    entry.timer = null;
    entries.delete(serverId);
  }
}

export function useSystemStats(serverId) {
  const [state, setState] = useState(() => (serverId ? getEntry(serverId).cache : EMPTY));

  useEffect(() => {
    if (!serverId) {
      setState(EMPTY);
      return undefined;
    }
    const entry = getEntry(serverId);
    entry.subscribers.add(setState);
    ensurePolling(serverId, entry);
    // Resync: the cache may have changed between render and effect, or serverId just changed.
    setState(entry.cache);
    return () => {
      entry.subscribers.delete(setState);
      stopPollingIfIdle(serverId, entry);
    };
  }, [serverId]);

  return state;
}
