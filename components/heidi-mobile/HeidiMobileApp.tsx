import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest } from '../../lib/heidi-mobile/client/api';
import { clearAll, loadPreferences, loadSnapshot, savePreferences, DEFAULT_PREFERENCES, type Preferences } from '../../lib/heidi-mobile/client/cache';
import { createRealtime, type RealtimeEvent, type RealtimeHandle, type RealtimeState } from '../../lib/heidi-mobile/client/realtime';
import { relativeTime, isStale } from '../../lib/heidi-mobile/client/format';
import { useAppHeight, useCachedResource, useNow, useOnline, useVisible } from './hooks';
import type { ActivitySnapshot, StatusSnapshot, Tab, TasksSnapshot } from './types';
import { Dot, describeState } from './ui';
import ChatView from './ChatView';
import StatusView from './StatusView';
import TasksView from './TasksView';
import ControlView from './ControlView';
import PairingView from './PairingView';

type Phase = 'checking' | 'unpaired' | 'paired' | 'server_unreachable';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'status', label: 'Status', icon: '📡' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'control', label: 'Control', icon: '🎛' },
];

export default function HeidiMobileApp() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sessionAvailable, setSessionAvailable] = useState(true);
  const [tab, setTab] = useState<Tab>('chat');
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [realtime, setRealtime] = useState<RealtimeState>('stopped');
  const [liveEvents, setLiveEvents] = useState<RealtimeEvent[]>([]);
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);

  const visible = useVisible();
  const online = useOnline();
  const now = useNow();
  const keyboardOpen = useAppHeight();
  const paired = phase === 'paired';
  const active = paired && visible;

  const status = useCachedResource<StatusSnapshot>('status', '/status', {
    enabled: active && online,
    // Live events trigger targeted refreshes, so poll slowly while the stream is up.
    intervalMs: realtime === 'live' ? 120000 : 30000,
  });
  const tasks = useCachedResource<TasksSnapshot>('tasks', '/tasks', {
    enabled: active && online,
    intervalMs: tab === 'tasks' ? 45000 : 120000,
  });
  const activity = useCachedResource<ActivitySnapshot>('activity', '/activity', {
    enabled: active && online && tab === 'status',
    intervalMs: 60000,
  });

  const checkSession = useCallback(async () => {
    const result = await heidiRequest<{ paired: boolean; device_id?: string; session_available?: boolean }>('/session', { timeoutMs: 10000 });
    if (result.ok) {
      setSessionAvailable(result.data.session_available !== false);
      setDeviceId(result.data.device_id || null);
      setPhase(result.data.paired ? 'paired' : 'unpaired');
      return result.data.paired;
    }
    // Heidi's own server is unreachable (phone offline, server down). If this
    // phone has been used before, open with the saved copies — clearly
    // labelled — instead of a dead end.
    if (['offline', 'network', 'timeout'].includes(result.error.kind)) {
      setPhase(loadSnapshot('status') ? 'paired' : 'server_unreachable');
    } else {
      setPhase('unpaired');
    }
    return false;
  }, []);

  useEffect(() => {
    const p = loadPreferences();
    setPrefs(p);
    setTab(p.lastTab);
    void checkSession();
  }, [checkSession]);

  // Re-check once the phone comes back online.
  useEffect(() => {
    if (online && (phase === 'server_unreachable' || (phase === 'paired' && !deviceId))) void checkSession();
  }, [online, phase, deviceId, checkSession]);

  const changePrefs = (next: Preferences) => {
    setPrefs(next);
    savePreferences(next);
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    changePrefs({ ...prefs, lastTab: next });
  };

  // ── Realtime ───────────────────────────────────────────
  const refreshTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const debounced = useCallback((key: string, fn: () => void, ms = 1500) => {
    clearTimeout(refreshTimers.current[key]);
    refreshTimers.current[key] = setTimeout(fn, ms);
  }, []);
  const statusRefresh = status.refresh;
  const tasksRefresh = tasks.refresh;
  const activityRefresh = activity.refresh;

  useEffect(() => {
    if (!active || !online) return undefined;
    const handle: RealtimeHandle = createRealtime({
      url: '/api/heidi-mobile/events',
      onStateChange: setRealtime,
      onEvent: (event) => {
        if (event.type === 'connected') return;
        setLiveEvents((list) => [{ ...event, timestamp: typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString() }, ...list].slice(0, 20));
        if (event.type === 'subsystem_status') debounced('status', () => void statusRefresh());
        if (event.type === 'notification') {
          debounced('activity', () => void activityRefresh());
          debounced('tasks', () => void tasksRefresh());
        }
      },
    });
    handle.start();
    const timers = refreshTimers.current;
    return () => {
      handle.stop();
      Object.values(timers).forEach(clearTimeout);
    };
  }, [active, online, realtimeEpoch, debounced, statusRefresh, tasksRefresh, activityRefresh]);

  const onAuthError = useCallback(() => {
    void checkSession();
    void statusRefresh();
  }, [checkSession, statusRefresh]);

  const unpair = async () => {
    await heidiRequest('/session', { method: 'DELETE' });
    clearAll();
    setDeviceId(null);
    setLiveEvents([]);
    setPhase('unpaired');
  };

  // ── Rendering ──────────────────────────────────────────
  const snap = status.data;
  const stateKey = !online ? 'phone_offline' : snap ? snap.state : status.error ? 'offline' : 'checking';
  const meta = describeState(stateKey);
  const stale = status.savedAt !== null && (status.fromCache || isStale(status.savedAt, now));
  const approvalsCount = tasks.data?.approvals.ok ? tasks.data.approvals.data.length : 0;

  if (phase === 'checking') {
    return (
      <div className={styles.app}>
        <div className={styles.center} role="status">Connecting to Heidi…</div>
      </div>
    );
  }

  if (phase === 'server_unreachable') {
    return (
      <div className={styles.app}>
        <div className={styles.center}>
          <div>
            <h1 style={{ fontSize: 22 }}>Heidi server unreachable</h1>
            <p className={styles.muted}>
              {online ? 'This phone is online, but the Heidi server did not answer. Check that the HYDI PC is running and reachable (same Wi-Fi or Tailscale).'
                : 'Your phone is offline. Heidi will reconnect automatically when the connection returns.'}
            </p>
            <button type="button" className={styles.btnPrimary} onClick={() => void checkSession()}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'unpaired') {
    return (
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.brand}><span className={styles.brandMark}>H</span>Heidi</div>
        </header>
        <main className={styles.main}>
          <PairingView sessionAvailable={sessionAvailable} onPaired={checkSession} />
        </main>
      </div>
    );
  }

  const banner = !online
    ? { cls: styles.bannerBad, text: 'Phone offline — showing data saved on this phone. Nothing here is live.' }
    : snap?.state === 'pending_approval'
      ? { cls: styles.bannerInfo, text: `Waiting for an owner to approve device ${snap.device_id}. Heidi checks again automatically.` }
      : snap?.state === 'unauthorized'
        ? { cls: styles.bannerBad, text: 'HYDI rejected this phone’s credentials. Unpair in Control and pair again.' }
        : snap?.state === 'offline'
          ? { cls: styles.bannerBad, text: 'HYDI unavailable — see Status for what to check.' }
          : null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.brandMark}>H</span>Heidi</div>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.pillButton}
          onClick={() => selectTab('status')}
          aria-label={`Connection: ${meta.label}${stale && status.savedAt ? `, last checked ${relativeTime(status.savedAt, now)}` : ''}. Open status.`}
        >
          <Dot tone={meta.tone} />
          {meta.label}
          {stale && status.savedAt ? ` · ${relativeTime(status.savedAt, now)}` : ''}
        </button>
      </header>

      {banner && !keyboardOpen && <div className={`${styles.banner} ${banner.cls}`} role="status">{banner.text}</div>}

      <main className={styles.main}>
        {tab === 'chat' && (
          <ChatView
            online={online}
            speakReplies={prefs.speakReplies}
            onAuthError={onAuthError}
            onTasksChanged={() => void tasks.refresh()}
          />
        )}
        {tab === 'status' && (
          <StatusView status={status} activity={activity} online={online} realtime={realtime} liveEvents={liveEvents} now={now} />
        )}
        {tab === 'tasks' && <TasksView tasks={tasks} online={online} now={now} onAuthError={onAuthError} />}
        {tab === 'control' && (
          <ControlView
            status={status}
            deviceId={deviceId}
            online={online}
            realtime={realtime}
            prefs={prefs}
            now={now}
            onPrefsChange={changePrefs}
            onRefreshAll={() => { void status.refresh(); void tasks.refresh(); void activity.refresh(); }}
            onReconnect={() => setRealtimeEpoch((n) => n + 1)}
            onUnpair={unpair}
            onAuthError={onAuthError}
            onCommandQueued={() => void tasks.refresh()}
          />
        )}
      </main>

      <nav className={`${styles.nav} ${keyboardOpen ? styles.navHidden : ''}`} aria-label="Heidi sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.navButton}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => selectTab(t.id)}
          >
            <span className={styles.navIcon} aria-hidden="true">{t.icon}</span>
            {t.label}
            {t.id === 'tasks' && approvalsCount > 0 && (
              <span className={styles.badge} aria-label={`${approvalsCount} awaiting approval`}>{approvalsCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
