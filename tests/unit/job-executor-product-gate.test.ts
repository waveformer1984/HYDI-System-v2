/**
 * REVENUE_PATH_NOT_WIRED guard — lib/revenue/JobExecutor.ts.
 *
 * JobExecutor must never run the 3D-model artifact generator for a
 * product it cannot actually deliver (e.g. rezonate_song). A paid job
 * for an unexecutable product must be blocked + escalated, not produce
 * wrong artifacts.
 */

const mockRequestIntervention = jest.fn(async () => ({}));
const mockStartExecution = jest.fn();
const mockGetJob = jest.fn();
const mockGenerateModelPackage = jest.fn(() => ({
  artifacts: [{ path: 'x', filename: 'f', sizeBytes: 1, sha256: 's' }],
}));

jest.mock('../../lib/revenue/JobManager', () => ({
  getJobManager: () => ({
    getJob: mockGetJob,
    startExecution: mockStartExecution,
    requestIntervention: mockRequestIntervention,
    ensureJobArtifactDir: jest.fn(() => 'C:\\tmp\\x'),
    getArtifactsDir: jest.fn(() => 'C:\\tmp'),
    failExecution: jest.fn(),
    completeExecution: jest.fn(async () => ({
      jobStatus: 'awaiting_review', paymentStatus: 'paid',
      deliveryStatus: 'pending', artifactPaths: ['x'],
    })),
    approveForDelivery: jest.fn(),
  }),
}));

jest.mock('../../lib/revenue/ModelArtifactGenerator', () => ({
  generateModelPackage: (...a: unknown[]) => mockGenerateModelPackage(...a),
  verifyArtifacts: () => ({ verified: true, details: 'ok' }),
}));

jest.mock('../../lib/revenue/DeliveryVerifier', () => ({
  verifyDeliverableArtifacts: () => ({ artifactHashes: {}, boundsMm: {} }),
  deliveryEligibility: () => ({ eligible: true, reason: 'auto-qa pass' }),
}));

import { executeJob } from '../../lib/revenue/JobExecutor';

const job = (product: string, status = 'queued') => ({
  jobId: 'job-1', product, jobStatus: status, requestText: 'x',
  paymentStatus: 'paid', deliveryStatus: 'pending', artifactPaths: [],
  requirements: {},
});

describe('JobExecutor product dispatch', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('protoforge_model_prep executes normally', async () => {
    mockGetJob.mockResolvedValue(job('protoforge_model_prep'));
    const r = await executeJob('job-1');
    expect(mockGenerateModelPackage).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(mockRequestIntervention).not.toHaveBeenCalled();
  });

  it('rezonate_song is blocked + escalated, never generates model artifacts', async () => {
    mockGetJob.mockResolvedValue(job('rezonate_song'));
    const r = await executeJob('job-1');
    expect(mockGenerateModelPackage).not.toHaveBeenCalled();
    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(mockRequestIntervention).toHaveBeenCalledWith(
      'job-1', 'executor-job-1', expect.stringContaining('REVENUE_PATH_NOT_WIRED'),
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("no executor for product 'rezonate_song'");
  });
});
