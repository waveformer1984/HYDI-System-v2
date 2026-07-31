# Switchboard — IDE Build Prompt

Copy everything below into your IDE's AI assistant (Claude Code, Cursor, etc.) as the initial project prompt.

---

```
Build a mobile-first app called Switchboard.

WHAT IT IS
Switchboard is a secure gig-work copilot and operations dashboard for managing
multiple delivery platforms from one unified interface. It helps a user
evaluate runs, track performance, coordinate with an approved partner, and
stay organized across gig apps. Initial target platforms are DoorDash and
Favor, with an architecture that can later expand to Uber Eats, Instacart,
Upside, and other support modules. Switchboard does not replace those
platforms or bypass their rules — it is a decision-support and workflow
layer that sits alongside them.

PRIMARY USERS
- Owner/operator (admin).
- Approved partner: Ginny Contreras.

CORE GOALS
1. One unified control layer for gig work.
2. Show whether a run is good or bad before acceptance.
3. Floating overlay / copilot pop-up over the native gig apps.
4. Secure, device-locked access — approved devices only.
5. QR code pairing for onboarding and partner access.
6. Tag-team mode for shared shopping / collaborative run support.
7. Track earnings, mileage, fuel, time, zones, and net estimates.
8. Optional savings/support modules (Upside, insurance tracking).
9. Stay compliant, safe, and non-invasive toward third-party apps.
10. Feel like a dispatch console — operational, not a toy or social app.

HARD CONSTRAINTS (non-negotiable)
- Never automate, scrape, click, or bypass protections in third-party gig
  apps unless those apps explicitly allow it.
- No hidden bot behavior. No credential harvesting. No anonymous access.
- No account sharing outside approved roles/devices. No multi-user
  concurrent login inside parent apps like Favor.
- Favor and similar parent apps must remain single-session,
  single-device, single-lead-user from their own perspective at all
  times. Switchboard coordinates people around Favor; it must never
  duplicate or mirror a Favor login across devices.
- If no official API exists for a platform, use manual entry or permitted
  integrations only — never reverse-engineered automation.
- Safest architecture: dashboard + scoring engine + overlay + task
  coordination + secure auth, all at Switchboard's own layer.

BRAND & DESIGN
- Name: Switchboard. Tone: operational, calm, professional, trustworthy.
- Visual style: dark, high-contrast, clean, mobile-first, minimal clutter,
  card-based panels, clean typography, one-handed fast use. No cartoonish
  or playful styling — it should feel like a control room, not an app for
  fun.

USER FLOW

1. Onboarding
   - Explain Switchboard is a copilot, not a replacement for gig apps.
   - Create/sign into the owner account.
   - Require PIN or biometric unlock.
   - Let the user set preferred apps, notification style, overlay style,
     and minimum profit floor.

2. QR Pairing & Access
   - Owner generates a QR code inside Switchboard.
   - Partner (e.g. Ginny) scans it on her own device to register securely.
   - Assign a role: owner, partner, helper, or limited collaborator.
   - Encrypt stored access data; allow revocation of any device/session at
     any time; maintain an audit log of login, pairing, revocation, and
     role changes.
   - QR pairing grants Switchboard access only — never parent-app
     credential sharing.

3. Dashboard
   - Connected apps and status: available, active, paused, offline.
   - Current run / active task.
   - Earnings by app, day, week, zone.
   - Mileage, fuel cost estimate, estimated net.
   - Zone quality and store notes.
   - Savings modules (Upside, insurance) as secondary cards.

4. Floating Copilot Overlay
   - Movable floating widget / edge pop-up, never blocking the native gig
     app.
   - Shows run score, payout estimate, miles, estimated minutes,
     recommendation.
   - Actions: Accept, Decline, Pause, Next App, Complete.
   - Supports drag, pin, hide, expand; subtle alerts, sounds, haptics.

5. Run Scoring
   - Weighted evaluation using payout, tip, miles, estimated time, wait
     time, pickup difficulty, store reliability, deadhead risk, zone
     quality, time of day, drop-off complexity.
   - Primary signals: profit per hour, profit per mile.
   - Verdicts: Strong Run / Okay Run / Weak Run / Reject, each with a
     plain-language explanation.
   - User-configurable minimum profit floor.
   - Formula shape: Score = weighted profitability + efficiency - delay -
     risk + zone bonus. Profit/hour weighted highest, profit/mile weighted
     strongly; long mileage, slow pickups, and weak zones reduce score;
     strong historical store/zone reliability increases it.

6. Tag-Team Mode
   - Shared run/shop mode inside Switchboard only.
   - One approved user claims the order as lead; a second approved user
     joins from their own device via Switchboard access.
   - Both devices see item list, task notes, progress.
   - Task roles: shopper, navigator, bagger, communicator, recorder (e.g.
     one navigates while the other shops).
   - Sessions are time-limited, revocable, auditable; prevent duplicate
     ownership conflicts; make it obvious who owns final completion.
   - Must never make the parent app believe multiple people are logged
     into the same account.
   - Hard rule for Favor and similar apps: one live session, one device,
     one lead user, one session owner — always.

7. Parent-App Safety Model
   - Never create multiple concurrent logins in Favor or similar apps.
   - Coordinate helpers outside the parent app; only the designated lead
     shopper interacts with the parent app itself.
   - Helpers work inside Switchboard, never by duplicating the parent
     app session.
   - If a parent app has no team-workflow support, emulate collaboration
     only at Switchboard's own layer.

8. Tracking & Analytics
   - Log every run/task: timestamp, app, store, zone, payout, miles,
     duration, outcome.
   - Track fuel, maintenance, tolls, other expenses; estimate net
     earnings after costs.
   - Surface best stores, best zones, best times of day.
   - Day/week/month summaries; exportable history for review or taxes.

9. Savings Modules
   - Upside: secondary savings/fuel-value module.
   - Insurance: back-burner savings and risk module — starts as a policy
     tracker, renewal reminder, and savings-awareness tool only. Do not
     act as a regulated insurance broker unless properly licensed and
     compliant.
   - Keep both modules separate from the core dispatch flow.

10. Device & Session Management
    - List authorized devices; revoke, reauthorize, expire sessions.
    - Store session tokens securely; require biometric/PIN re-entry for
      sensitive actions; keep full session history in the audit trail.

SETTINGS
Minimum profit floor, preferred apps, notification style, overlay
appearance, shared-mode defaults, fuel cost assumptions, expense
categories, savings-module visibility, role permissions.

DATA MODEL
User, Role, Device, SessionToken, AppAccount, Run, Offer, Score, Zone,
StoreNote, SharedSession, TaskAssignment, EarningsEntry, ExpenseEntry,
SavingsModule, AuditLog.

SUGGESTED ARCHITECTURE
- Frontend: React Native or Flutter, mobile-first.
- Native overlay module where the platform requires it.
- Backend API for authentication, pairing, logs, and role management.
- PostgreSQL (or equivalent) database.
- Secure storage for session secrets and tokens.
- Event-driven analytics for runs and sessions.
- Notification system for alerts and reminders.

MVP SCOPE
Owner account; Ginny partner account; QR device pairing; secure
role-based access; dashboard; floating overlay; manual run scoring;
DoorDash + Favor support; run tracking; tag-team mode; audit logs; basic
Upside placeholder; basic insurance-tracker placeholder; parent-app
safety-rule enforcement.

FUTURE EXPANSION (build for, don't build now)
Uber Eats, Instacart, better forecasting, historical recommendations,
additional savings integrations, more advanced shared workflows,
optional regulated insurance workflows only if licensed/compliant.

ACCEPTANCE CRITERIA
- Opens to a clear dashboard.
- QR pairing works securely; Ginny can access only after approval.
- Overlay works as a copilot over other apps without blocking them.
- Run scoring gives explainable recommendations.
- Tag-team mode supports two approved users on one shared shop inside
  Switchboard.
- Favor and similar parent apps remain single-session and undisturbed.
- Earnings, mileage, and expense tracking are present.
- Device access can be revoked instantly.
- Nothing in the app violates third-party app rules or enables
  disallowed automation.

Write production-quality code with modular structure, secure auth, clean
component boundaries, and placeholders for future integrations. Make the
codebase easy to expand, audit, and maintain.
```
