import { BaseAgent } from '../base.agent';

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

  async handle_event(event: any): Promise<void> {
    console.log(`[Rezonate Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'REZONATE_LIST_PROJECTS':
      case 'REZONATE_CREATE_PROJECT':
      case 'REZONATE_LIST_TRACKS':
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
        break;
      default:
        this.emit_event('REZONATE_TASK_UNHANDLED', {
          task_type: event.type,
          reason: 'unknown_task_type',
          timestamp: new Date().toISOString(),
        }, 'heidi_controller', 'low');
    }
  }
}
