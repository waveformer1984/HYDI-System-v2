import styles from '../../styles/heidi-mobile.module.css';
import { relativeTime } from '../../lib/heidi-mobile/client/format';
import type { RealtimeEvent, RealtimeState } from '../../lib/heidi-mobile/client/realtime';
import type { Loadable } from './hooks';
import type { ActivitySnapshot, StatusSnapshot } from './types';
import { Dot, Freshness, SectionError, describeState, toneForStatus } from './ui';

const SUBSYSTEM_LABELS: Record<string, string> = {
  hydi_core: 'HYDI core',
  ursula: 'Ursula monitor',
  rave_voice: 'Voice (RAVE)',
  botforge: 'BotForge',
  worker_fleet: 'Worker fleet',
  memory: 'Memory',
  database: 'Database',
  deployment: 'Deployment',
};

interface Props {
  status: Loadable<StatusSnapshot>;
  activity: Loadable<ActivitySnapshot>;
  online: boolean;
  realtime: RealtimeState;
  liveEvents: RealtimeEvent[];
  now: number;
}

function describeLiveEvent(e: RealtimeEvent): string {
  if (e.type === 'subsystem_status') return `${SUBSYSTEM_LABELS[String(e.subsystem)] || String(e.subsystem)} → ${String(e.status)}`;
  if (e.type === 'notification') return `Notification: ${String(e.category || e.title || 'new')}`;
  if (e.type === 'ingested_event') return `Event ingested${e.event_type ? `: ${String(e.event_type)}` : ''}`;
  return e.type.replace(/_/g, ' ');
}

export default function StatusView({ status, activity, online, realtime, liveEvents, now }: Props) {
  const snap = status.data;
  const stateKey = !online ? 'phone_offline' : snap ? snap.state : status.error ? 'offline' : 'checking';
  const meta = describeState(stateKey);
  const realtimeLabel = realtime === 'live' ? 'Live' : realtime === 'reconnecting' ? 'Reconnecting…' : realtime === 'connecting' ? 'Connecting…' : 'Off — using periodic refresh';

  return (
    <div className={styles.scroll}>
      <section className={styles.section} aria-labelledby="hs-state">
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <h2 id="hs-state" className={styles.stateTitle} style={{ margin: 0 }}>
              <Dot tone={meta.tone} />
              {meta.label}
            </h2>
            <button type="button" className={styles.btn} onClick={() => { void status.refresh(); void activity.refresh(); }} disabled={status.loading || !online}>
              {status.loading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
          <p className={styles.muted} style={{ marginBottom: 6 }}>{meta.detail}</p>
          <Freshness savedAt={status.savedAt} fromCache={status.fromCache} now={now} loading={status.loading} />
          {status.error && (
            <p className={styles.errorText} role="alert" style={{ marginBottom: 0 }}>
              Latest check failed: {status.error.message}
              {snap ? ' — showing the last good status, which may be out of date.' : ''}
            </p>
          )}
          {snap?.system && (
            <div className={styles.metrics}>
              <div className={styles.metric}>
                <div className={styles.muted}>Health score</div>
                <div className={styles.metricValue}>{snap.system.health_score}/100</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.muted}>API latency</div>
                <div className={styles.metricValue}>{snap.api.latency_ms != null ? `${snap.api.latency_ms} ms` : '—'}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.muted}>Live updates</div>
                <div className={styles.metricValue} style={{ fontSize: 15 }}>{realtimeLabel}</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.muted}>Jobs queued / failed</div>
                <div className={styles.metricValue}>
                  {snap.health?.jobs_queued ?? '—'} / {snap.health?.jobs_failed ?? '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {snap?.health && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>System verdict</h3>
          <div className={styles.card}>
            <div className={styles.cardRow}>
              <span>Dashboard status</span>
              <span className={styles.statusLabel}><Dot tone={toneForStatus(snap.health.hydi_status)} />{snap.health.hydi_status || 'not reported'}</span>
            </div>
            <div className={styles.cardRow} style={{ marginTop: 6 }}>
              <span>Trend</span>
              <span className={styles.muted}>{snap.health.trend_status || 'not reported'}</span>
            </div>
            {snap.health.escalation_level && snap.health.escalation_level !== 'OK' && (
              <p className={styles.errorText} style={{ marginBottom: 0 }}>
                Escalation {snap.health.escalation_level}{snap.health.escalation_reason ? `: ${snap.health.escalation_reason}` : ''}
              </p>
            )}
            <div className={`${styles.muted} ${styles.small}`} style={{ marginTop: 6 }}>
              Source: {snap.health.source || 'unknown'} · last run {relativeTime(snap.health.last_check, now)}
            </div>
          </div>
        </section>
      )}

      {snap?.system && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Subsystems</h3>
          <ul className={`${styles.list} ${styles.listCard}`}>
            {snap.system.subsystems.map((s) => (
              <li key={s.name} className={styles.listItem}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{SUBSYSTEM_LABELS[s.name] || s.name}</div>
                  <div className={`${styles.muted} ${styles.small}`}>
                    {s.last_heartbeat ? `heartbeat ${relativeTime(s.last_heartbeat, now)}` : 'never reported'}
                  </div>
                </div>
                <span className={styles.statusLabel}><Dot tone={toneForStatus(s.status)} />{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snap && snap.errors.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Check details</h3>
          {snap.errors.map((e, i) => (
            <SectionError key={i} error={{ ...e, message: `${e.source === 'health' ? 'Health check' : 'Status snapshot'}: ${e.message}` }} />
          ))}
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <span>Activity</span>
          <Freshness savedAt={activity.savedAt} fromCache={activity.fromCache} now={now} loading={activity.loading} />
        </h3>
        {liveEvents.length > 0 && (
          <ul className={`${styles.list} ${styles.listCard}`} aria-label="Live events this session">
            {liveEvents.slice(0, 10).map((e, i) => (
              <li key={i} className={styles.listItem}>
                <span className={styles.itemMain}>{describeLiveEvent(e)}</span>
                <span className={`${styles.muted} ${styles.small}`}>{relativeTime(typeof e.timestamp === 'string' ? e.timestamp : null, now)}</span>
              </li>
            ))}
          </ul>
        )}
        {activity.error && <SectionError error={activity.error} />}
        {activity.data && activity.data.notifications.length === 0 && (
          <div className={styles.card}><span className={styles.muted}>HYDI has no notifications.</span></div>
        )}
        {activity.data && activity.data.notifications.length > 0 && (
          <ul className={`${styles.list} ${styles.listCard}`}>
            {activity.data.notifications.slice(0, 20).map((n, i) => (
              <li key={n.id || i} className={styles.listItem}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>
                    {!n.read && <span className={styles.srOnly}>Unread: </span>}
                    {n.title || n.category || 'Notification'}
                  </div>
                  {n.body && <div className={`${styles.muted} ${styles.small}`}>{n.body}</div>}
                  <div className={`${styles.muted} ${styles.small}`}>{n.severity || 'info'} · {relativeTime(n.created_at, now)}</div>
                </div>
                {!n.read && <Dot tone="info" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
