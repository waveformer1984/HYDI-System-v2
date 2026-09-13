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
import fs from 'fs';
import path from 'path';

export interface ExecutionResult {
  jobId: string;
  success: boolean;
  artifacts: ArtifactResult[];
  error?: string;
  durationMs: number;
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
    // Start execution (if not already running)
    if (job.jobStatus === 'queued') {
      await jobManager.startExecution(jobId);
    }

    // Generate artifacts
    const outputDir = jobManager.ensureJobArtifactDir(jobId);
    const requirements = job.requirements as Record<string, unknown>;

    const generationResult = generateModelPackage({
      jobId,
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
    await jobManager.completeExecution(jobId, generationResult.artifacts.map(a => ({
      path: a.path,
      metadata: {
        filename: a.filename,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        ...a.metadata,
      },
    })));

    return {
      jobId,
      success: true,
      artifacts: generationResult.artifacts,
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

    // Check if artifacts were produced before the crash
    if (fs.existsSync(jobDir)) {
      const files = fs.readdirSync(jobDir);
      const hasScad = files.some(f => f.endsWith('.scad'));
      const hasStl = files.some(f => f.endsWith('.stl'));
      const hasReadme = files.includes('README.md');

      if (hasScad && hasStl && hasReadme) {
        // Artifacts exist — complete the job
        const artifacts = files.map(f => {
          const fullPath = path.join(jobDir, f);
          const stat = fs.statSync(fullPath);
          return { path: fullPath, metadata: { filename: f, sizeBytes: stat.size } };
        });
        await jobManager.completeExecution(job.jobId, artifacts);
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
