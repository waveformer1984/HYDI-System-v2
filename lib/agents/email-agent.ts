import { SpecialistAgent } from './base-agent';

export class EmailAgent extends SpecialistAgent {
  readonly id = 'email-agent';
  readonly actionType = 'send_email';
}
