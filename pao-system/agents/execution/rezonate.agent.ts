import { BaseAgent } from '../base.agent';
import * as rezonateClient from '../../../lib/rezonate/rezonate-client';

/**
 * Rezonate agent for the PAO task router.
 *
 * This agent accepts canonical Rezonate task types and emits events; it does
 * not hold autonomous execution authority. Mutating operations are routed to
 * the canonical local repository only after `lib/auth/rbac.js` `rezonate:manage`
 * permission is verified by the caller. Delete/publish/ownership/spend/external
 * operations are explicitly excluded from autonomous execution.
 */
export class RezonateAgent extends BaseAgent {
  constructor() {
    super('rezonate.agent', [
      'REZONATE_LIST_PROJECTS',
      'REZONATE_CREATE_PROJECT',
      'REZONATE_LIST_TRACKS',
      'REZONATE_CREATE_TRACK',
      'REZONATE_GET_JOB',
      'REZONATE_CREATE_JOB',
      'REZONATE_START_JOB',
      'REZONATE_EXPORT_PROJECT',
      'REZONATE_HEALTH',
    ]);
  }

  async handle_event(event: any): Promise<any> {
    console.log(`[Rezonate Agent] Handling event: ${event.type}`);

    const input = event?.payload?.input;
    const taskId = event?.task_id || 'unknown';

    const audit = (result: any, success: boolean, reason?: string) => {
      const payload = {
        task_type: event.type,
        task_id: taskId,
        input,
        result,
        success,
        failure_reason: reason || null,
        routed_by: this.id,
        timestamp: new Date().toISOString(),
      };
      this.emit_event(
        success ? 'REZONATE_TASK_COMPLETED' : 'REZONATE_TASK_FAILED',
        payload,
        'heidi_controller',
        success ? 'medium' : 'high'
      );
    };

    switch (event.type) {
      case 'REZONATE_CREATE_PROJECT':
        if (!input || typeof input.name !== 'string') {
          const reason = 'REZONATE_CREATE_PROJECT requires { name: string }';
          audit(null, false, reason);
          throw new Error(reason);
        }
        try {
          const project = await rezonateClient.createProject(input);
          const result = { ok: true, project };
          audit(result, true);
          return result;
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          audit(null, false, reason);
          throw e;
        }

      case 'REZONATE_LIST_PROJECTS':
        try {
          const projects = await rezonateClient.listProjects();
          const result = { ok: true, count: projects.length, projects };
          audit(result, true);
          return result;
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          audit(null, false, reason);
          throw e;
        }

      case 'REZONATE_GET_PROJECT':
        if (!input || typeof input.id !== 'string') {
          const reason = 'REZONATE_GET_PROJECT requires { id: string }';
          audit(null, false, reason);
          throw new Error(reason);
        }
        try {
          const project = await rezonateClient.getProject(input.id);
          const result = { ok: true, project };
          audit(result, true);
          return result;
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          audit(null, false, reason);
          throw e;
        }

      case 'REZONATE_CREATE_TRACK':
        if (!input || typeof input.projectId !== 'string' || typeof input.name !== 'string') {
          const reason = 'REZONATE_CREATE_TRACK requires { projectId: string, name: string }';
          audit(null, false, reason);
          throw new Error(reason);
        }
        try {
          const track = await rezonateClient.createTrack(input.projectId, { name: input.name });
          const result = { ok: true, track };
          audit(result, true);
          return result;
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          audit(null, false, reason);
          throw e;
        }

      case 'REZONATE_LIST_TRACKS':
        if (!input || typeof input.projectId !== 'string') {
          const reason = 'REZONATE_LIST_TRACKS requires { projectId: string }';
          audit(null, false, reason);
          throw new Error(reason);
        }
        try {
          const tracks = await rezonateClient.listTracks(input.projectId);
          const result = { ok: true, count: tracks.length, tracks };
          audit(result, true);
          return result;
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          audit(null, false, reason);
          throw e;
        }

      case 'REZONATE_GET_JOB':
      case 'REZONATE_CREATE_JOB':
      case 'REZONATE_START_JOB':
      case 'REZONATE_EXPORT_PROJECT':
      case 'REZONATE_HEALTH':
        this.emit_event('REZONATE_TASK_ROUTED', {
          task_type: event.type,
          task_id: taskId,
          payload: event.payload,
          routed_by: this.id,
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'medium');
        return { ok: true, routed: event.type };

      default:
        this.emit_event('REZONATE_TASK_UNHANDLED', {
          task_type: event.type,
          task_id: taskId,
          reason: 'unknown_task_type',
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'low');
        return { ok: false, reason: 'unknown_task_type' };
    }
  }
}
