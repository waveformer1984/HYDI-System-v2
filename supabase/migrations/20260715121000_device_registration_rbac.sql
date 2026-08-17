-- devices + auth_audit_log — Phase 4 of the mobile-ops build: device
-- registration/revocation and an authentication audit trail, sitting on
-- top of the existing HMAC service-token scheme (lib/auth/verifyServiceToken.js).
-- A device is issued its own secret at registration time; every request
-- from that device signs with its own secret so a single compromised
-- device can be revoked without rotating the shared HYDI_SERVICE_SECRET.
--
-- Roles (checked in lib/auth/rbac.js, not enforced by Postgres): OWNER
-- (full control), OPERATOR (manage workers, run approved commands),
-- AGENT (execute assigned tasks only), VIEWER (read-only).
--
-- Additive and idempotent (safe to re-run).

create table if not exists public.devices (
  id             uuid primary key default gen_random_uuid(),
  device_id      text not null unique,
  device_name    text,
  role           text not null default 'viewer'
                   check (role in ('owner', 'operator', 'agent', 'viewer')),
  secret_hash    text not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'revoked')),
  approved_by    text,
  approved_at    timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_devices_status on public.devices (status);
create index if not exists idx_devices_role   on public.devices (role);

alter table public.devices enable row level security;

drop policy if exists "devices_service_all" on public.devices;
create policy "devices_service_all" on public.devices
  for all to service_role
  using (true)
  with check (true);

-- auth_audit_log — every auth attempt (success or failure), every
-- control-command request, and every rate-limit trip. Append-only.
create table if not exists public.auth_audit_log (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null
                 check (event_type in (
                   'auth_success', 'auth_failure', 'device_registered',
                   'device_approved', 'device_revoked', 'rate_limited',
                   'command_requested', 'command_rejected', 'permission_denied'
                 )),
  device_id    text,
  role         text,
  ip_address   text,
  reason       text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_auth_audit_log_created_at on public.auth_audit_log (created_at desc);
create index if not exists idx_auth_audit_log_device_id  on public.auth_audit_log (device_id);
create index if not exists idx_auth_audit_log_event_type on public.auth_audit_log (event_type);

alter table public.auth_audit_log enable row level security;

drop policy if exists "auth_audit_log_service_all" on public.auth_audit_log;
create policy "auth_audit_log_service_all" on public.auth_audit_log
  for all to service_role
  using (true)
  with check (true);
