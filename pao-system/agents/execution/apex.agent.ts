import { BaseAgent } from '../base.agent';
import * as apexClient from '../../../lib/apex/apex-client';
import * as apexCapability from '../../../lib/apex/apex-capability-guard';

/**
 * Apex Archive agent for the Heidi control plane.
 *
 * This agent is strictly one-way: it records locally ingested Apex events and
 * maintains the project identity mapping. It does NOT operate the archive,
 * does NOT publish, and does NOT read Apex's internal state files directly.
 */
export class ApexAgent extends BaseAgent {
  constructor() {
    super('apex.agent', [
      'APEX_EVENT_RECORDED',
      'APEX_EPISODE_CREATED',
      'APEX_EPISODE_APPROVED',
      'APEX_EPISODE_PUBLISHED',
      'APEX_EPISODE_FAILED',
      'APEX_EPISODE_ARCHIVED',
    ]);
  }

  async handle_event(event: any): Promise<any> {
    console.log(`[Apex Agent] Handling event: ${event.type}`);

    const input = event?.payload?.input;
    const taskId = event?.task_id || 'unknown';

    const capability = (apexCapability as any).getTaskCapabilityState(event.type);
    if (capability.heidiState !== 'VERIFIED') {
      const reason = capability.reason || `${event.type} is not a verified Heidi capability (state: ${capability.heidiState})`;
      this.emit_event('APEX_TASK_FAILED', {
        task_type: event.type,
        task_id: taskId,
        input,
        reason,
        timestamp: new Date().toISOString(),
      }, 'heidi_controller', 'high');
      return { ok: false, reason };
    }

    if (!input || !input.event) {
      const reason = 'Apex events require { event: object }';
      this.emit_event('APEX_TASK_FAILED', {
        task_type: event.type,
        task_id: taskId,
        input,
        reason,
        timestamp: new Date().toISOString(),
      }, 'heidi_controller', 'high');
      return { ok: false, reason };
    }

    try {
      const mapping = apexClient.getOrCreateProjectMapping(
        input.venture_id || 'apex-archive',
        input.rezonate_project_id || 'unmapped'
      );
      const recorded = apexClient.recordEvent(input.event);
      const result = { ok: true, mapping, recorded };
      this.emit_event('APEX_TASK_COMPLETED', {
        task_type: event.type,
        task_id: taskId,
        input,
        result,
        timestamp: new Date().toISOString(),
      }, 'heidi_controller', 'medium');
      return result;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown error';
      this.emit_event('APEX_TASK_FAILED', {
        task_type: event.type,
        task_id: taskId,
        input,
        reason,
        timestamp: new Date().toISOString(),
      }, 'heidi_controller', 'high');
      throw e;
    }
  }
}
