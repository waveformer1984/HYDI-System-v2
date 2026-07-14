import { SpecialistAgent } from './base-agent';

export class DatabaseAgent extends SpecialistAgent {
  readonly id = 'database-agent';
  readonly actionType = 'update_database';
}
