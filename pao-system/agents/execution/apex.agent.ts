import { BaseAgent } from '../base.agent';
import * as apexClient from '../../../lib/apex/apex-client';
import * as apexCapability from '../../../lib/apex/apex-capability-guard';
import * as rezonateClient from '../../../lib/rezonate/rezonate-client';

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
      'APEX_PROJECT_CREATED',
      'APEX_EPISODE_CREATED',
      'GET_APEX_PROJECT_STATUS',
      'GET_APEX_HEALTH',
      'GET_APEX_REZONATE_STATUS',
      'APEX_EVENT_RECORDED',
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

    if (!input) {
      const reason = 'Apex events require input payload';
      this.emit_event('APEX_TASK_FAILED', {
        task_type: event.type,
        task_id: taskId,
        input,
        reason,
        timestamp: new Date().toISOString(),
      }, 'heidi_controller', 'high');
      return { ok: false, reason };
    }

    const ventureId = input.apex_venture_id || input.venture_id || 'apex-archive';

    try {
      switch (event.type) {
        case 'APEX_PROJECT_CREATED':
          return await this._ensureProject(ventureId, input, taskId);
        case 'GET_APEX_PROJECT_STATUS':
          return await this._getProjectStatus(ventureId, input, taskId);
        case 'GET_APEX_HEALTH':
          return this._success('GET_APEX_HEALTH', taskId, input, apexClient.getHealth());
        case 'GET_APEX_REZONATE_STATUS':
          return await this._getApexRezonateStatus(input, taskId);
        case 'APEX_EPISODE_CREATED':
          return await this._recordEpisode(ventureId, input, taskId);
        default:
          return await this._recordEvent(ventureId, input, taskId);
      }
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

  private async _ensureProject(ventureId: string, input: any, taskId: string): Promise<any> {
    const projectName = input.project_name || ventureId;

    let mapping = apexClient.getProjectMapping(ventureId);
    if (mapping && mapping.rezonate_project_id) {
      return this._success('APEX_PROJECT_CREATED', taskId, input, {
        mapping,
        rezonate_project: await (rezonateClient as any).getProject(mapping.rezonate_project_id),
        idempotent: true,
      });
    }

    const projects = await (rezonateClient as any).listProjects();
    const existing = projects.find((p: any) => p.name === projectName);
    const project = existing || await (rezonateClient as any).createProject({ name: projectName });

    mapping = apexClient.ensureProjectMapping(ventureId, project.id);
    return this._success('APEX_PROJECT_CREATED', taskId, input, {
      mapping,
      rezonate_project: project,
      idempotent: false,
    });
  }

  private async _getProjectStatus(ventureId: string, input: any, taskId: string): Promise<any> {
    const mapping = apexClient.getProjectMapping(ventureId);
    if (!mapping || !mapping.rezonate_project_id) {
      return { ok: false, reason: `Apex project ${ventureId} has not been ingested` };
    }
    try {
      const project = await (rezonateClient as any).getProject(mapping.rezonate_project_id);
      const episodes = apexClient.listEpisodes(ventureId);
      return this._success('GET_APEX_PROJECT_STATUS', taskId, input, {
        mapping,
        rezonate_project: project,
        episodes_recorded: episodes.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { ok: false, reason: `Rezonate project missing: ${msg}` };
    }
  }

  private async _getApexRezonateStatus(input: any, taskId: string): Promise<any> {
    const projects = await (rezonateClient as any).listProjects();
    const apex = apexClient.getHealth();
    const controller = { available: true, evidence: 'HeidiController routing GET_APEX_REZONATE_STATUS' };
    const local = { ok: true, apex_data_dir: apex.data_dir, persistence: 'local JSON' };
    const cloud = { supabase_url: process.env.SUPABASE_URL || null, supabase_key_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY };
    return this._success('GET_APEX_REZONATE_STATUS', taskId, input, {
      controller,
      apex,
      rezonate: { count: projects.length, available: true },
      local,
      cloud,
    });
  }

  private async _recordEpisode(ventureId: string, input: any, taskId: string): Promise<any> {
    const mapping = apexClient.getProjectMapping(ventureId);
    if (!mapping || !mapping.rezonate_project_id) {
      return { ok: false, reason: `Apex project ${ventureId} has not been ingested` };
    }
    const episode = input.episode || input;
    const recorded = apexClient.recordEpisode(ventureId, episode);
    return this._success('APEX_EPISODE_CREATED', taskId, input, {
      mapping,
      recorded,
      rezonate_project_id: mapping.rezonate_project_id,
    });
  }

  private async _recordEvent(ventureId: string, input: any, taskId: string): Promise<any> {
    const event = input.event || input;
    const recorded = apexClient.recordEvent(event);
    return this._success(event.event_type || input.task_type || 'APEX_EVENT_RECORDED', taskId, input, { recorded });
  }

  private _success(taskType: string, taskId: string, input: any, result: any) {
    this.emit_event('APEX_TASK_COMPLETED', {
      task_type: taskType,
      task_id: taskId,
      input,
      result,
      timestamp: new Date().toISOString(),
    }, 'heidi_controller', 'medium');
    return { ok: true, ...result };
  }
}
