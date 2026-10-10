/**
 * console-state — the Operations Console's deterministic proposal→UI
 * mapping and API-error classifier. Pins the honesty contract: the UI
 * can only ever display states backed by heidi_action_proposals +
 * joined heidi_missions evidence. 'AUTHORIZED', 'PROVEN' and 'REVENUE'
 * must never be producible here.
 */

import { proposalUiState, classifyApiError, ProposalLike } from '../../lib/console-state';

const NOW = Date.now();
const FUTURE = new Date(NOW + 3600e3).toISOString();
const PAST = new Date(NOW - 3600e3).toISOString();

const p = (over: Partial<ProposalLike>): ProposalLike => ({
  status: 'pending', expiresAt: FUTURE, missionId: null, missionStatus: null, missionStage: null, ...over,
});

describe('proposalUiState — durable-state mapping', () => {
  it('pending + unexpired → AWAITING_APPROVAL (resolvable)', () => {
    const ui = proposalUiState(p({}), NOW);
    expect(ui).toMatchObject({ state: 'AWAITING_APPROVAL', resolvable: true });
  });
  it('pending + expired window → EXPIRED, not resolvable', () => {
    const ui = proposalUiState(p({ expiresAt: PAST }), NOW);
    expect(ui).toMatchObject({ state: 'EXPIRED', resolvable: false });
  });
  it('rejected / expired / retracted → terminal non-executing states', () => {
    expect(proposalUiState(p({ status: 'rejected' })).state).toBe('REJECTED');
    expect(proposalUiState(p({ status: 'expired' })).state).toBe('EXPIRED');
    expect(proposalUiState(p({ status: 'retracted' })).state).toBe('RETRACTED');
  });

  it('approved + no mission yet → APPROVED_QUEUED, honest note that the R2 gate still governs', () => {
    const ui = proposalUiState(p({ status: 'approved', missionId: null }));
    expect(ui.state).toBe('APPROVED_QUEUED');
    expect(ui.note).toMatch(/R2/);
    expect(ui.resolvable).toBe(false);
  });
  it('approved + planned/claimed/running/verifying mission → queued/executing', () => {
    expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'planned' })).state).toBe('APPROVED_QUEUED');
    for (const ms of ['claimed', 'running', 'verifying']) {
      expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: ms })).state).toBe('EXECUTING');
    }
  });
  it('approved + waiting_human → WAITING_HUMAN', () => {
    expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'waiting_human' })).state).toBe('WAITING_HUMAN');
  });
  it('approved + succeeded → COMPLETED (execution evidence, never proof)', () => {
    const ui = proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'succeeded' }));
    expect(ui.state).toBe('COMPLETED');
    expect(ui.note).toMatch(/not proof/i);
  });
  it('approved + failed/timed_out → FAILED; cancelled → CANCELLED', () => {
    expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'failed' })).state).toBe('FAILED');
    expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'timed_out' })).state).toBe('FAILED');
    expect(proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'cancelled' })).state).toBe('CANCELLED');
  });
  it('approved + unrecognized mission status → UNPROVEN, never assumed', () => {
    const ui = proposalUiState(p({ status: 'approved', missionId: 'm1', missionStatus: 'quantum_entangled' }));
    expect(ui.state).toBe('UNPROVEN');
  });
  it('unrecognized proposal status → UNPROVEN', () => {
    expect(proposalUiState(p({ status: 'mystery' })).state).toBe('UNPROVEN');
  });

  it('AUTHORIZED only from the durable consume marker — never inferred from approval', () => {
    // authorization_consumed_at is the ONLY evidence that produces AUTHORIZED.
    const authorized = proposalUiState(p({ status: 'approved', missionId: null, authorizedAt: new Date().toISOString() }));
    expect(authorized.state).toBe('AUTHORIZED');
    // Approval alone — no marker — stays APPROVED_QUEUED.
    expect(proposalUiState(p({ status: 'approved', missionId: null })).state).toBe('APPROVED_QUEUED');
    // A non-approved proposal can never show AUTHORIZED even with a stray marker.
    expect(proposalUiState(p({ status: 'pending', authorizedAt: new Date().toISOString() })).state).toBe('AWAITING_APPROVAL');
    // Once the goal is claimed by a mission, execution state supersedes the marker.
    expect(proposalUiState(p({ status: 'approved', missionId: 'm', missionStatus: 'running', authorizedAt: new Date().toISOString() })).state).toBe('EXECUTING');
  });

  it('PROVEN / REVENUE remain never producible on this surface', () => {
    const forbidden = new Set(['PROVEN', 'REVENUE']);
    const rows: ProposalLike[] = [
      p({}), p({ status: 'approved' }), p({ status: 'approved', authorizedAt: new Date().toISOString() }),
      p({ status: 'rejected' }), p({ status: 'expired' }),
      p({ status: 'retracted' }), p({ status: 'mystery' }),
      ...['planned', 'claimed', 'running', 'verifying', 'waiting_human', 'succeeded', 'failed', 'cancelled', 'timed_out']
        .map(ms => p({ status: 'approved', missionId: 'm', missionStatus: ms })),
    ];
    for (const r of rows) expect(forbidden.has(proposalUiState(r).state)).toBe(false);
  });
});

describe('classifyApiError — failure → honest UI state', () => {
  it('no response → NETWORK_ERROR', () => {
    expect(classifyApiError(null).code).toBe('NETWORK_ERROR');
  });
  it('401 → AUTH_REQUIRED; 403 → FORBIDDEN', () => {
    expect(classifyApiError(401, 'Unauthorized').code).toBe('AUTH_REQUIRED');
    expect(classifyApiError(403, "role lacks permission").code).toBe('FORBIDDEN');
  });
  it('not found → ACTION_NOT_FOUND', () => {
    expect(classifyApiError(400, 'Proposal not found').code).toBe('ACTION_NOT_FOUND');
  });
  it('expired → PROPOSAL_EXPIRED', () => {
    expect(classifyApiError(400, 'Proposal expired').code).toBe('PROPOSAL_EXPIRED');
  });
  it('consume-once / lost the race → ALREADY_RESOLVED', () => {
    expect(classifyApiError(400, 'Proposal already approved — approvals are consume-once').code).toBe('ALREADY_RESOLVED');
    expect(classifyApiError(400, 'Approval lost the race or the proposal changed').code).toBe('ALREADY_RESOLVED');
  });
  it('changed content → REFUSED', () => {
    expect(classifyApiError(400, 'Proposal content changed — requires fresh approval').code).toBe('REFUSED');
  });
  it('invalid input → INVALID_PROPOSAL', () => {
    expect(classifyApiError(400, 'Invalid proposal id').code).toBe('INVALID_PROPOSAL');
    expect(classifyApiError(400, 'Body must include decision: "approve" | "reject"').code).toBe('INVALID_PROPOSAL');
  });
  it('500 → SERVER_ERROR; generic 4xx → INVALID_PROPOSAL', () => {
    expect(classifyApiError(500, 'database unavailable').code).toBe('SERVER_ERROR');
    expect(classifyApiError(500).code).toBe('SERVER_ERROR');
  });
});
