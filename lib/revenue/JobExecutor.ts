/**
 * HEIDI Job Executor
 *
 * Picks up queued customer jobs and executes them through the governed
 * HumanActionEngine path. This is the bridge between the revenue pipeline
 * (payment → job) and HEIDI's governed execution.
 *
 * Execution flow:
 *   1. Get next queued job
 *   2. Start execution (job → 'executing')
 *   3. Generate artifacts using ModelArtifactGenerator
 *   4. Verify artifacts
 *   5. Complete execution (job → 'awaiting_review')
 *   6. Human reviews and approves delivery
 *
 * The executor uses filesystem.write_file (R1, autonomous) for artifact
 * generation. No external dependencies required.
 *
 * Restart recovery:
 *   If HEIDI restarts during execution, the job remains in 'executing'
 *   state. On restart, the executor checks for stale 'executing' jobs
 *   and either resumes or fails them based on whether artifacts exist.
 */

import { getJobManager, JobManager, CustomerJob } from './JobManager';
import { generateModelPackage, verifyArtifacts, ArtifactResult } from './ModelArtifactGenerator';
import { verifyDeliverableArtifacts, deliveryEligibility } from './DeliveryVerifier';
import fs from 'fs';
import path from 'path';

export interface ExecutionResult {
  jobId: string;
  success: boolean;
  artifacts: ArtifactResult[];
  delivered?: boolean;
  deliveryReason?: string;
  error?: string;
  durationMs: number;
}

/**
 * Products with a real artifact executor. protoforge_model_prep is wired
 * end-to-end (generateModelPackage → OpenSCAD/STL/README) and
 * checkpoint_audit via the Ursula engine (analyze → audit report). Other
 * sellable offers (e.g. rezonate_song) have no executor — running the
 * model package generator for them would deliver the WRONG product to a
 * paying customer. Fail-closed: block the job and escalate instead.
 */
const EXECUTABLE_PRODUCTS = new Set(['protoforge_model_prep', 'checkpoint_audit']);

/** Product → generator. The paid product determines the artifacts. */
async function generateForProduct(job: CustomerJob, outputDir: string): Promise<{ artifacts: ArtifactResult[] }> {
  const requirements = job.requirements as Record<string, unknown>;
  if (job.product === 'checkpoint_audit') {
    const { generateCheckpointAudit } = await import('./CheckpointAuditGenerator');
    return generateCheckpointAudit({
      jobId: job.jobId,
      requestText: job.requestText,
      requirements: {
        steps: requirements.steps as Array<Record<string, unknown> | string> | undefined,
        workflowName: requirements.workflowName as string | undefined,
        category: requirements.category as string | undefined,
        projectId: requirements.projectId as number | undefined,
      },
      outputDir,
    });
  }
  return generateModelPackage({
    jobId: job.jobId,
    requestText: job.requestText,
    requirements: {
      objectType: requirements.objectType as string | undefined,
      width: requirements.width as number | undefined,
      height: requirements.height as number | undefined,
      depth: requirements.depth as number | undefined,
      thickness: requirements.thickness as number | undefined,
      material: requirements.material as string | undefined,
      rushOrder: requirements.rushOrder as boolean | undefined,
    },
    outputDir,
  });
}

/**
 * Execute a single queued job end-to-end.
 */
export async function executeJob(jobId: string): Promise<ExecutionResult> {
  const start = Date.now();
  const jobManager = getJobManager();

  const job = await jobManager.getJob(jobId);
  if (!job) {
    return { jobId, success: false, artifacts: [], error: 'Job not found', durationMs: 0 };
  }

  if (job.jobStatus !== 'queued' && job.jobStatus !== 'executing') {
    return {
      jobId,
      success: false,
      artifacts: [],
      error: `Job is not queued or executing (status: ${job.jobStatus})`,
      durationMs: 0,
    };
  }

  try {
    // REVENUE_PATH_NOT_WIRED guard — check BEFORE generating anything.
    // A product with no executor must never reach generateModelPackage:
    // producing 3D-model artifacts for an audio/other-product order is
    // a wrong-delivery, and could even auto-deliver via deliveryEligibility.
    if (!EXECUTABLE_PRODUCTS.has(job.product)) {
      await jobManager.requestIntervention(
        jobId, `executor-${jobId}`,
        `REVENUE_PATH_NOT_WIRED: product '${job.product}' has no artifact executor — blocked rather than delivering wrong artifacts`,
      );
      return {
        jobId,
        success: false,
        artifacts: [],
        error: `no executor for product '${job.product}'`,
        durationMs: Date.now() - start,
      };
    }

    // Start execution (if not already running)
    if (job.jobStatus === 'queued') {
      await jobManager.startExecution(jobId);
    }

    // Generate artifacts — the generator is per-product; the paid product
    // determines what "deliverable" means.
    const outputDir = jobManager.ensureJobArtifactDir(jobId);
    const generationResult = await generateForProduct(job, outputDir);

    // Verify artifacts
    const verification = verifyArtifacts(generationResult.artifacts);
    if (!verification.verified) {
      await jobManager.failExecution(jobId, `Artifact verification failed: ${verification.details}`);
      return {
        jobId,
        success: false,
        artifacts: generationResult.artifacts,
        error: verification.details,
        durationMs: Date.now() - start,
      };
    }

    // Complete execution — job moves to 'awaiting_review'
    const completed = await jobManager.completeExecution(jobId, generationResult.artifacts.map(a => ({
      path: a.path,
      metadata: {
        filename: a.filename,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        ...a.metadata,
      },
    })));

    // Autonomous delivery gate — independent QA decides whether the
    // routine human review is needed at all. PASS → deliver; anything
    // else stays awaiting_review with an escalated human reason.
    const jobDir = path.join(jobManager.getArtifactsDir(), jobId);
    const report = verifyDeliverableArtifacts(jobDir, { product: job.product });
    const elig = deliveryEligibility(
      { jobStatus: completed.jobStatus, paymentStatus: completed.paymentStatus, deliveryStatus: completed.deliveryStatus, artifactPaths: completed.artifactPaths },
      report,
    );
    if (elig.eligible) {
      await jobManager.approveForDelivery(jobId, 'auto-qa',
        `independent QA PASS — artifacts ${Object.keys(report.artifactHashes).join(', ')}, bounds ${JSON.stringify(report.boundsMm)}`);
    } else if (completed.paymentStatus === 'paid') {
      await jobManager.requestIntervention(jobId, 'delivery-' + jobId, 'delivery_not_eligible: ' + elig.reason);
    }

    return {
      jobId,
      success: true,
      artifacts: generationResult.artifacts,
      delivered: elig.eligible,
      deliveryReason: elig.reason,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await jobManager.failExecution(jobId, msg);
    return {
      jobId,
      success: false,
      artifacts: [],
      error: msg,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Process the next queued job (if any).
 * Returns null if no jobs are queued.
 */
export async function processNextJob(): Promise<ExecutionResult | null> {
  const jobManager = getJobManager();
  // Atomic claim, not a plain read. With more than one poller process running
  // (which the boot supervisor has been observed to produce), a SELECT followed
  // by a separate startExecution() lets two executors take the same paid job.
  // claimNextQueuedJob() moves the row to 'executing' in one statement under
  // FOR UPDATE SKIP LOCKED, so at most one caller can ever receive it.
  const job = await jobManager.claimNextQueuedJob();
  if (!job) return null;
  // The job is already 'executing' at this point, so executeJob() will skip its
  // own startExecution() call — the transition and its audit event happened
  // inside the claim.
  return executeJob(job.jobId);
}

/**
 * Recover stale 'executing' jobs after a restart.
 * If artifacts exist on disk, complete the job.
 * If not, fail it.
 */
export async function recoverStaleJobs(): Promise<{ recovered: number; failed: number }> {
  const jobManager = getJobManager();
  const staleJobs = await jobManager.getJobsByStatus('executing');

  let recovered = 0;
  let failed = 0;

  for (const job of staleJobs) {
    const jobDir = path.join(jobManager.getArtifactsDir(), job.jobId);

    // Check if artifacts were produced before the crash — the expected
    // set is per-product (audit jobs don't produce .stl files).
    if (fs.existsSync(jobDir)) {
      const files = fs.readdirSync(jobDir);
      const complete = job.product === 'checkpoint_audit'
        ? files.includes('checkpoint-audit.md') && files.includes('audit-data.json')
        : files.some(f => f.endsWith('.scad')) && files.some(f => f.endsWith('.stl')) && files.includes('README.md');

      if (complete) {
        // Artifacts exist — complete the job
        const artifacts = files.map(f => {
          const fullPath = path.join(jobDir, f);
          const stat = fs.statSync(fullPath);
          return { path: fullPath, metadata: { filename: f, sizeBytes: stat.size } };
        });
        const completedJob = await jobManager.completeExecution(job.jobId, artifacts);
        // Same autonomous gate — recovery doesn't bypass delivery QA.
        const report = verifyDeliverableArtifacts(jobDir, { product: job.product });
        const elig = deliveryEligibility(
          { jobStatus: completedJob.jobStatus, paymentStatus: completedJob.paymentStatus, deliveryStatus: completedJob.deliveryStatus, artifactPaths: completedJob.artifactPaths },
          report,
        );
        if (elig.eligible) {
          await jobManager.approveForDelivery(job.jobId, 'auto-qa', `independent QA PASS after restart recovery — ${JSON.stringify(report.boundsMm)}`);
        } else {
          await jobManager.requestIntervention(job.jobId, 'delivery-' + job.jobId, 'delivery_not_eligible: ' + elig.reason);
        }
        recovered++;
      } else {
        // Partial artifacts — fail
        await jobManager.failExecution(job.jobId, 'Restarted during execution with incomplete artifacts');
        failed++;
      }
    } else {
      // No artifacts — fail
      await jobManager.failExecution(job.jobId, 'Restarted during execution before artifacts were produced');
      failed++;
    }
  }

  return { recovered, failed };
}

/**
 * Sweep paid 'awaiting_review' jobs through the same autonomous gate —
 * jobs that were queued before the gate existed, or whose delivery was
 * interrupted, still qualify; exceptions stay put and escalate.
 */
export async function sweepAwaitingReview(): Promise<{ delivered: number; escalated: number }> {
  const jobManager = getJobManager();
  const jobs = await jobManager.getJobsByStatus('awaiting_review');
  let delivered = 0;
  let escalated = 0;
  for (const job of jobs) {
    const jobDir = path.join(jobManager.getArtifactsDir(), job.jobId);
    const report = verifyDeliverableArtifacts(jobDir, { product: job.product });
    const elig = deliveryEligibility(
      { jobStatus: job.jobStatus, paymentStatus: job.paymentStatus, deliveryStatus: job.deliveryStatus, artifactPaths: job.artifactPaths },
      report,
    );
    if (elig.eligible) {
      await jobManager.approveForDelivery(job.jobId, 'auto-qa', `independent QA PASS (sweep) — ${JSON.stringify(report.boundsMm)}`);
      delivered++;
    } else if (job.paymentStatus === 'paid' && report.verdict === 'FAIL' && job.interventionStatus !== 'requested') {
      // A paid job with definitively failing QA is a human exception —
      // flag it once, don't loop on it.
      await jobManager.requestIntervention(job.jobId, `delivery_not_eligible:${elig.reason}`);
      escalated++;
    }
  }
  return { delivered, escalated };
}

/**
 * Human approves a job for delivery.
 * This is the human gate — the operator reviews the artifacts
 * and decides whether to deliver them to the customer.
 */
export async function approveDelivery(jobId: string, approvedBy: string, notes?: string): Promise<CustomerJob> {
  const jobManager = getJobManager();
  return jobManager.approveForDelivery(jobId, approvedBy, notes);
}

/**
 * Reject delivery — the artifacts are not good enough.
 * The job goes back to 'failed' and the customer gets a refund.
 */
export async function rejectDelivery(jobId: string, rejectedBy: string, reason: string): Promise<CustomerJob> {
  const jobManager = getJobManager();
  await jobManager.failExecution(jobId, `Delivery rejected by ${rejectedBy}: ${reason}`);
  return (await jobManager.getJob(jobId))!;
}
