import { useCallback, useEffect, useRef, useState } from 'react';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { loadSnapshot, saveSnapshot } from '../../lib/heidi-mobile/client/cache';
import type { StatusSnapshot } from './types';

/** True while the page is visible; polling and realtime pause when hidden to save battery. */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** The phone's own network state (navigator.onLine), independent of HYDI. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Re-render periodically so relative timestamps ("2 min ago") stay honest. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Tracks the visual viewport so the layout shrinks above the on-screen
 * keyboard on browsers that don't honour `interactive-widget=resizes-content`,
 * and reports whether the keyboard is probably open.
 */
export function useAppHeight(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const baseline = { h: window.innerHeight };
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      baseline.h = Math.max(baseline.h, window.innerHeight);
      setKeyboardOpen(vv.height < baseline.h * 0.75);
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
  return keyboardOpen;
}

export interface Loadable<T> {
  data: T | null;
  /** When `data` was fetched (live) or saved (cache). */
  savedAt: number | null;
  /** True when `data` came from the on-phone cache, not a response in this session. */
  fromCache: boolean;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
}

/**
 * Fetch-with-cache for one BFF endpoint. Shows the cached snapshot
 * immediately (labelled as cached), then replaces it with a live response;
 * on failure keeps the last good data but records the error so the UI can
 * say both "this is old" and "why".
 */
export function useCachedResource<T>(
  key: 'status' | 'tasks' | 'activity',
  path: string,
  opts: { enabled: boolean; intervalMs: number | null; timeoutMs?: number },
): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    const snap = loadSnapshot<T>(key);
    if (snap) {
      setData(snap.data);
      setSavedAt(snap.savedAt);
      setFromCache(true);
    }
  }, [key]);

  const refresh = useCallback(async () => {
    if (inflight.current) inflight.current.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    const result = await heidiRequest<T>(path, { signal: controller.signal, timeoutMs: opts.timeoutMs ?? 20000 });
    if (controller.signal.aborted) return;
    inflight.current = null;
    setLoading(false);
    if (result.ok) {
      const now = Date.now();
      setData(result.data);
      setSavedAt(now);
      setFromCache(false);
      setError(null);
      saveSnapshot(key, result.data, now);
    } else {
      setError(result.error);
    }
  }, [key, path, opts.timeoutMs]);

  useEffect(() => {
    if (!opts.enabled) return undefined;
    void refresh();
    if (!opts.intervalMs) return undefined;
    const t = setInterval(() => { void refresh(); }, opts.intervalMs);
    return () => clearInterval(t);
  }, [opts.enabled, opts.intervalMs, refresh]);

  useEffect(() => () => { if (inflight.current) inflight.current.abort(); }, []);

  return { data, savedAt, fromCache, loading, error, refresh };
}

export type StatusResource = Loadable<StatusSnapshot>;
