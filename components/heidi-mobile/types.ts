/** Response shapes of pages/api/heidi-mobile/* (see lib/heidi-mobile/normalize.js). */

export type ConnectionState =
  | 'online' | 'degraded' | 'offline' | 'unauthorized' | 'pending_approval' | 'forbidden' | 'unconfigured';

export interface UpstreamError {
  source?: string;
  kind: string;
  message: string;
  reason?: string;
}

export interface Subsystem {
  name: string;
  status: 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';
  health_score: number;
  last_heartbeat: string | null;
}

export interface Worker {
  worker_id: string | null;
  worker_type: string;
  status: string;
  last_heartbeat: string | null;
  processed_count: number | null;
  error_count: number | null;
}

export interface StatusDiagnostics {
  upstream_valid: boolean;
  upstream_host: string | null;
  upstream_uses_default: boolean;
  service_secret_configured: boolean;
  device_pending_at_pairing: boolean;
}

export interface StatusSnapshot {
  state: ConnectionState;
  checked_at: string;
  latency_ms: number;
  api: { reachable: boolean; latency_ms: number | null };
  device_id: string;
  diagnostics?: StatusDiagnostics;
  health: {
    status: string | null;
    hydi_status: string | null;
    trend_status: string | null;
    escalation_level: string | null;
    escalation_reason: string | null;
    last_check: string | null;
    source: string | null;
    jobs_queued: number | null;
    jobs_failed: number | null;
  } | null;
  system: {
    overall_status: 'healthy' | 'degraded' | 'critical' | 'offline';
    health_score: number;
    subsystems: Subsystem[];
    workers: Worker[];
    recent_events: Array<{ subsystem: string | null; from_status: string | null; to_status: string | null; at: string | null }>;
    reported_at: string | null;
  } | null;
  errors: UpstreamError[];
}

export type Section<T> = { ok: true; data: T } | { ok: false; error: UpstreamError };

export interface Approval {
  id: string;
  action_type: string;
  summary: string | null;
  session_id: string | null;
  created_at: string | null;
}

export interface WorkSession {
  id: string | null;
  goal: string | null;
  status: string;
  current_task: string | null;
  completed_steps: number;
  total_steps: number;
  created_at: string | null;
  completed_at: string | null;
}

export interface Command {
  id: string | null;
  worker_type: string | null;
  worker_id: string | null;
  command: string | null;
  status: string;
  error: string | null;
  requested_by: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface MissionApproval {
  id: number;
  goal: string;
  status: string;
  priority: number;
  assigned_agent: string | null;
  created_at: string | null;
}

export interface TasksSnapshot {
  checked_at: string;
  approvals: Section<Approval[]>;
  work: Section<{ sessions: WorkSession[]; queue_depth: number }>;
  commands: Section<Command[]>;
  missions: Section<MissionApproval[]>;
}

export interface Notification {
  id: string | null;
  category: string | null;
  severity: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  read: boolean;
}

export interface ActivitySnapshot {
  checked_at: string;
  notifications: Notification[];
  unread_count: number;
}

export type Tab = 'chat' | 'status' | 'tasks' | 'jobs' | 'control';

export type JobDecision = 'shortlisted' | 'dismissed' | 'applied';

export interface JobLead {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  description: string;
  company: string | null;
  budget: { min: number | null; max: number | null; currency: string; type: string; text?: string | null };
  skills: string[];
  postedAt: string | null;
  score: number;
  division: string | null;
  matched: string[];
  reasons: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  draft: string | null;
  notifiedAt?: string | null;
  decision?: { status: JobDecision; at: string } | null;
}

export interface JobScoutStatus {
  ranAt?: string;
  ok?: boolean;
  fetched?: number;
  kept?: number;
  newLeads?: number;
  newStrong?: number;
  sources?: Record<string, { ok: boolean; count: number; ms?: number; error?: string }>;
  notify?: { candidates?: number; sent?: number; batched?: boolean; deferred?: boolean; error?: string };
}

export interface JobScoutSnapshot {
  ok: boolean;
  status: JobScoutStatus | null;
  decisions: Record<string, { status: JobDecision; at: string }>;
  leads: JobLead[];
}
