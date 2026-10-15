/**
 * Phone-facing reading of an execution-fabric response.
 * HTTP acceptance and executor claims are not treated as verification.
 */

export type FabricDisposition =
  | 'verified'
  | 'duplicate'
  | 'failed'
  | 'pending_approval'
  | 'accepted_unverified'
  | 'rejected'
  | 'unavailable';

export interface FabricPhoneSummary {
  disposition: FabricDisposition;
  verified: boolean;
  duplicate: boolean;
  task_id: string | null;
  correlation_id: string | null;
  state: string | null;
  public_state: string | null;
  upstream_status: number | null;
  headline: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function summarizeFabricResult(data: unknown): FabricPhoneSummary {
  const body = asRecord(data);
  const task = asRecord(body?.task);
  const state = typeof task?.state === 'string' ? task.state : null;
  const publicState = typeof task?.public_state === 'string' ? task.public_state : null;
  const verification = asRecord(task?.verification);
  const verified = verification?.verified === true && (state === 'COMPLETED' || publicState === 'succeeded');
  const duplicate = body?.duplicate === true;
  const awaiting = body?.awaiting_approval === true || state === 'AWAITING_APPROVAL' || publicState === 'awaiting_approval';
  const taskId = typeof task?.id === 'string' ? task.id : null;
  const correlationId = typeof task?.correlation_id === 'string' ? task.correlation_id : null;
  const upstream = typeof body?.upstream_status === 'number' ? body.upstream_status : null;

  let disposition: FabricDisposition = 'unavailable';
  if (!body) disposition = 'unavailable';
  else if (duplicate) disposition = 'duplicate';
  else if (verified) disposition = 'verified';
  else if (awaiting || state === 'NEEDS_HUMAN' || publicState === 'needs_human') disposition = 'pending_approval';
  else if (state === 'FAILED' || state === 'BLOCKED' || publicState === 'failed' || publicState === 'blocked' || body.ok === false) disposition = 'failed';
  else if (body.accepted === true || state === 'RUNNING' || state === 'VERIFYING' || publicState === 'running' || publicState === 'verifying') disposition = 'accepted_unverified';
  else if (typeof body.error === 'string') disposition = 'rejected';

  const headline = headlineFor(disposition, publicState || state);
  return {
    disposition,
    verified,
    duplicate,
    task_id: taskId,
    correlation_id: correlationId,
    state,
    public_state: publicState,
    upstream_status: upstream,
    headline,
  };
}

function headlineFor(disposition: FabricDisposition, stateLabel: string | null): string {
  switch (disposition) {
    case 'verified': return 'Verified complete';
    case 'duplicate': return 'Same task returned — no second run';
    case 'failed': return `Not verified${stateLabel ? ` (${stateLabel})` : ''}`;
    case 'pending_approval': return 'Waiting for approval';
    case 'accepted_unverified': return `Accepted, not verified yet${stateLabel ? ` (${stateLabel})` : ''}`;
    case 'rejected': return 'Rejected';
    default: return 'No task result';
  }
}
