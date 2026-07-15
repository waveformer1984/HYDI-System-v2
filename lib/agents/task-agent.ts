import { SpecialistAgent } from './base-agent';

export class TaskAgent extends SpecialistAgent {
  readonly id = 'task-agent';
  readonly actionType = 'create_task';
}
