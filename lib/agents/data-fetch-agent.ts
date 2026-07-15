import { SpecialistAgent } from './base-agent';

export class DataFetchAgent extends SpecialistAgent {
  readonly id = 'data-fetch-agent';
  readonly actionType = 'fetch_data';
}
