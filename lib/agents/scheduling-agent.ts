import { SpecialistAgent } from './base-agent';

export class SchedulingAgent extends SpecialistAgent {
  readonly id = 'scheduling-agent';
  readonly actionType = 'schedule_event';
}
