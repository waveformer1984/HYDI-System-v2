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

    switch (event.type) {
      case 'REZONATE_CREATE_PROJECT':
        if (!input || typeof input.name !== 'string') {
          throw new Error('REZONATE_CREATE_PROJECT requires { name: string }');
        }
        const project = await rezonateClient.createProject(input);
        this.emit_event('REZONATE_PROJECT_CREATED', {
          task_type: event.type,
          project,
          routed_by: this.id,
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'medium');
        return { ok: true, project };

      case 'REZONATE_LIST_PROJECTS':
        const projects = await rezonateClient.listProjects();
        this.emit_event('REZONATE_PROJECTS_LISTED', {
          task_type: event.type,
          count: projects.length,
          routed_by: this.id,
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'medium');
        return { ok: true, count: projects.length, projects };

      case 'REZONATE_CREATE_TRACK':
      case 'REZONATE_GET_JOB':
      case 'REZONATE_CREATE_JOB':
      case 'REZONATE_START_JOB':
      case 'REZONATE_EXPORT_PROJECT':
      case 'REZONATE_HEALTH':
        this.emit_event('REZONATE_TASK_ROUTED', {
          task_type: event.type,
          payload: event.payload,
          routed_by: this.id,
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'medium');
        return { ok: true, routed: event.type };

      default:
        this.emit_event('REZONATE_TASK_UNHANDLED', {
          task_type: event.type,
          reason: 'unknown_task_type',
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'low');
        return { ok: false, reason: 'unknown_task_type' };
    }
  }
}
