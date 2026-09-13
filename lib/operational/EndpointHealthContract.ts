/**
 * Endpoint Health Contracts
 * ---------------------------------------------------------------------------
 * Phase II (false-green elimination).
 *
 * Before this module, scripts/watchdog.js decided endpoint health with:
 *
 *     ok: res.statusCode >= 200 && res.statusCode < 500
 *
 * That predicate reported `heidi-web` as healthy while /api/health was
 * returning HTTP 200 with {"status":"degraded"}, and would have reported a
 * 404 (endpoint gone) as healthy too. The watchdog logged
 * "OK all 6 endpoints healthy" while the revenue job executor was failing on
 * every poll.
 *
 * A transport-level status code says the process accepted a socket. It says
 * nothing about whether the service is doing its job. This module makes the
 * distinction explicit: every monitored endpoint declares what its body must
 * contain for the service to be considered healthy, and an endpoint with no
 * declared contract is UNKNOWN -- never HEALTHY.
 *
 * The state vocabulary is the existing operational one (ComponentState in
 * ./types), so watchdog verdicts line up with SystemStateModel and the
 * .hydi-operational event log rather than inventing a parallel taxonomy.
 */

import type { ComponentState } from './types';

/** Subset of ComponentState an endpoint observation can produce. */
export type EndpointHealthState = Extract<
  ComponentState,
  'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN'
>;

export interface EndpointObservation {
  /** HTTP status code, or 0 when no response was obtained. */
  statusCode: number;
  /** Raw response body (may be truncated by the caller). */
  bodyText: string;
  /** Set when the request never completed (timeout, ECONNREFUSED, ...). */
  transportError?: string;
}

export interface EndpointHealthVerdict {
  state: EndpointHealthState;
  /** True ONLY for HEALTHY. DEGRADED/UNKNOWN/UNAVAILABLE are all not-ok. */
  ok: boolean;
  /** Human-readable justification -- always populated, always logged. */
  reason: string;
  /**
   * True when the watchdog could not obtain usable evidence about the target
   * (unparseable body, undeclared contract). Distinct from a target failure:
   * callers must not authorize recovery on observer failure alone. This
   * mirrors the OBSERVER_FAILURE classification already used for the
   * infrastructure checks in ObservationConfidence.
   */
  observerFailure: boolean;
}

/**
 * What a given endpoint must prove before it counts as healthy.
 *
 * `predicate` receives the parsed JSON body and returns a verdict fragment.
 * It is only called once a 2xx response with a parseable JSON body exists.
 */
export interface EndpointHealthContract {
  /** boot.config.json module id. */
  name: string;
  /** Short description of what the endpoint promises. */
  contract: string;
  /**
   * When true, 401/403 is proof the service is up AND enforcing auth, so it
   * counts as HEALTHY. When false (default), an auth rejection means we could
   * not verify health -- UNKNOWN, not HEALTHY.
   */
  authRejectionIsHealthy?: boolean;
  predicate: (body: Record<string, unknown>) => {
    state: EndpointHealthState;
    reason: string;
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Contracts for the endpoints boot.config.json asks the watchdog to monitor.
 *
 * Each predicate is derived from the endpoint's actual implementation, not
 * invented:
 *   - protoforge-core    src/server.js            GET /health
 *   - heidi-web          api/health.js            GET /api/health
 *   - heidi-mobile-chat  launch-heidi-mobile.js   GET /api/health
 */
export const ENDPOINT_HEALTH_CONTRACTS: Record<string, EndpointHealthContract> = {
  'protoforge-core': {
    name: 'protoforge-core',
    contract:
      "src/server.js GET /health returns {status:'ok'|'degraded', modules, modules_state, events}. " +
      "'ok' requires the Supabase heidi_events probe to have actually returned a count.",
    predicate: (body) => {
      const status = body.status;
      if (status === undefined) {
        return { state: 'UNKNOWN', reason: "body has no 'status' field -- cannot verify health" };
      }
      if (status !== 'ok') {
        return { state: 'DEGRADED', reason: `status='${String(status)}' (not 'ok')` };
      }
      // status:'ok' alone was the old lie -- it was returned even when the only
      // thing proven was that Express accepted the request. Require the
      // evidence fields the handler now emits.
      if (!isFiniteNumber(body.events)) {
        return {
          state: 'DEGRADED',
          reason: "status='ok' but 'events' is not a number -- the database probe produced no evidence",
        };
      }
      if (body.modules_state === 'UNVERIFIED') {
        return {
          state: 'DEGRADED',
          reason: "status='ok' but modules_state='UNVERIFIED' -- module registry could not be read",
        };
      }
      return {
        state: 'HEALTHY',
        reason: `status='ok', events=${body.events}, modules=${String(body.modules)}`,
      };
    },
  },

  'heidi-web': {
    name: 'heidi-web',
    contract:
      "api/health.js GET /api/health returns status:'healthy'|'degraded'|'error' derived from the " +
      'system_dashboard view. Only "healthy" means healthy.',
    predicate: (body) => {
      const status = body.status;
      if (status === undefined) {
        return { state: 'UNKNOWN', reason: "body has no 'status' field -- cannot verify health" };
      }
      if (status === 'healthy') {
        return { state: 'HEALTHY', reason: "status='healthy'" };
      }
      if (status === 'degraded') {
        const detail =
          body.trend_reason !== undefined
            ? ` (hydi_status=${JSON.stringify(body.hydi_status)}, trend_reason=${JSON.stringify(body.trend_reason)})`
            : '';
        return { state: 'DEGRADED', reason: `status='degraded'${detail}` };
      }
      if (status === 'error') {
        return { state: 'UNAVAILABLE', reason: "status='error'" };
      }
      return { state: 'UNKNOWN', reason: `unrecognised status='${String(status)}'` };
    },
  },

  // Not a boot.config module, but scripts/watchdog.js monitors it alongside
  // them and had the identical status-code-only predicate.
  ollama: {
    name: 'ollama',
    contract:
      'Ollama GET /api/tags returns {models: [...]}. A running Ollama with no models cannot serve ' +
      'inference, so an empty list is DEGRADED rather than healthy.',
    predicate: (body) => {
      const models = body.models;
      if (!Array.isArray(models)) {
        return { state: 'UNKNOWN', reason: "body has no 'models' array -- cannot verify health" };
      }
      if (models.length === 0) {
        return { state: 'DEGRADED', reason: 'reachable but 0 models available -- cannot serve inference' };
      }
      return { state: 'HEALTHY', reason: `${models.length} model(s) available` };
    },
  },

  'heidi-mobile-chat': {
    name: 'heidi-mobile-chat',
    contract:
      "launch-heidi-mobile.js GET /api/health returns {server:'ok', ollama, lmstudio, heidiCore, models}. " +
      "server:'ok' is this service's own liveness; ollama/heidiCore are downstream dependencies reported " +
      'for visibility and monitored separately, so they do not by themselves fail this endpoint.',
    predicate: (body) => {
      if (body.server === undefined) {
        return { state: 'UNKNOWN', reason: "body has no 'server' field -- cannot verify health" };
      }
      if (body.server !== 'ok') {
        return { state: 'DEGRADED', reason: `server='${String(body.server)}' (not 'ok')` };
      }
      return {
        state: 'HEALTHY',
        reason: `server='ok' (ollama=${String(body.ollama)}, heidiCore=${String(body.heidiCore)})`,
      };
    },
  },
};

/**
 * Evaluate one endpoint observation against its declared contract.
 *
 * Never returns HEALTHY without positive evidence from the body. An endpoint
 * with no registered contract is UNKNOWN + observerFailure, because we have no
 * basis on which to judge it -- that is a gap in our monitoring, not a
 * statement about the target.
 */
export function evaluateEndpointHealth(
  name: string,
  obs: EndpointObservation
): EndpointHealthVerdict {
  const contract = ENDPOINT_HEALTH_CONTRACTS[name];

  // 1. No response at all -- the target did not answer.
  if (obs.transportError) {
    return {
      state: 'UNAVAILABLE',
      ok: false,
      reason: `no response: ${obs.transportError}`,
      observerFailure: false,
    };
  }

  // 2. No contract declared -- we cannot judge this endpoint.
  if (!contract) {
    return {
      state: 'UNKNOWN',
      ok: false,
      reason: `no health contract declared for '${name}' -- HTTP ${obs.statusCode} proves the socket was accepted, nothing more`,
      observerFailure: true,
    };
  }

  const code = obs.statusCode;

  // 3. Auth rejections: only healthy if the contract says so.
  if (code === 401 || code === 403) {
    return contract.authRejectionIsHealthy
      ? {
          state: 'HEALTHY',
          ok: true,
          reason: `HTTP ${code} -- endpoint is protected and enforcing auth, as its contract expects`,
          observerFailure: false,
        }
      : {
          state: 'UNKNOWN',
          ok: false,
          reason: `HTTP ${code} -- auth rejected, health could not be verified`,
          observerFailure: true,
        };
  }

  // 4. Server errors and missing endpoints are target failures.
  if (code >= 500) {
    return {
      state: 'UNAVAILABLE',
      ok: false,
      reason: `HTTP ${code} -- server error`,
      observerFailure: false,
    };
  }
  if (code === 404) {
    return {
      state: 'UNAVAILABLE',
      ok: false,
      reason: 'HTTP 404 -- health endpoint not found; the contract cannot be satisfied',
      observerFailure: false,
    };
  }
  if (code < 200 || code >= 400) {
    return {
      state: 'UNKNOWN',
      ok: false,
      reason: `HTTP ${code} -- unexpected status, health could not be verified`,
      observerFailure: true,
    };
  }

  // 5. 2xx/3xx: the body must satisfy the contract.
  let parsed: unknown;
  try {
    parsed = JSON.parse(obs.bodyText);
  } catch {
    return {
      state: 'UNKNOWN',
      ok: false,
      reason: `HTTP ${code} but body is not valid JSON -- health could not be verified`,
      observerFailure: true,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      state: 'UNKNOWN',
      ok: false,
      reason: `HTTP ${code} but body is not a JSON object -- health could not be verified`,
      observerFailure: true,
    };
  }

  const verdict = contract.predicate(parsed as Record<string, unknown>);
  return {
    state: verdict.state,
    ok: verdict.state === 'HEALTHY',
    reason: `HTTP ${code}; ${verdict.reason}`,
    // An UNKNOWN produced by the predicate means the body did not carry the
    // fields we need -- that is a failure to observe, not a proven target fault.
    observerFailure: verdict.state === 'UNKNOWN',
  };
}
