'use strict';

/**
 * Pins down the R2+ autonomy boundary for protoforge.daily_opportunity_scan:
 *   - approveOpportunity / rejectOpportunity are the only two functions
 *     that can move approval_status away from 'pending'.
 *   - executeApprovedOpportunity ALWAYS throws NOT_IMPLEMENTED, even for a
 *     genuinely approved record. There is no code path in v1 that causes
 *     an external action.
 *
 * If this test suite ever needs to change because someone implemented
 * real execution, that change must be deliberate and reviewed -- it is
 * exactly the kind of change that should never happen by accident.
 */

jest.mock('../../lib/missions/opportunity-store', () => ({
  setApproval: jest.fn(),
  getOpportunity: jest.fn(),
}));

const store = require('../../lib/missions/opportunity-store');
const { approveOpportunity, rejectOpportunity, executeApprovedOpportunity } = require('../../lib/missions/approval');

afterEach(() => jest.clearAllMocks());

describe('approval boundary: approve/reject', () => {
  it('approveOpportunity calls setApproval with "approved"', async () => {
    store.setApproval.mockResolvedValue({ id: '1', approval_status: 'approved' });
    await approveOpportunity('1', 'human');
    expect(store.setApproval).toHaveBeenCalledWith('1', 'approved', 'human', {});
  });

  it('rejectOpportunity calls setApproval with "rejected"', async () => {
    store.setApproval.mockResolvedValue({ id: '1', approval_status: 'rejected' });
    await rejectOpportunity('1', 'human');
    expect(store.setApproval).toHaveBeenCalledWith('1', 'rejected', 'human', {});
  });
});

describe('approval boundary: executeApprovedOpportunity is never implemented', () => {
  it('throws NOT_IMPLEMENTED even for a genuinely approved opportunity', async () => {
    store.getOpportunity.mockResolvedValue({ id: '1', approval_status: 'approved' });
    await expect(executeApprovedOpportunity('1')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('throws a distinct error for a not-yet-approved opportunity (fails before reaching NOT_IMPLEMENTED)', async () => {
    store.getOpportunity.mockResolvedValue({ id: '1', approval_status: 'pending' });
    await expect(executeApprovedOpportunity('1')).rejects.toThrow(/not approved/);
  });

  it('throws for a nonexistent opportunity', async () => {
    store.getOpportunity.mockResolvedValue(null);
    await expect(executeApprovedOpportunity('missing')).rejects.toThrow(/no opportunity/);
  });

  it('never calls setApproval itself -- execution cannot self-authorize', async () => {
    store.getOpportunity.mockResolvedValue({ id: '1', approval_status: 'approved' });
    await expect(executeApprovedOpportunity('1')).rejects.toBeTruthy();
    expect(store.setApproval).not.toHaveBeenCalled();
  });
});
