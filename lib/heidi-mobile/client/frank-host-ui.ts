/** Pure Frank host vitals card rules for Heidi Mobile Status (client bundle). */

export type FrankHostVitalsDotTone = 'ok' | 'warn' | 'bad';

export interface FrankHostVitalsInput {
  state: string;
  stale: boolean;
}

export function isFrankHostCardVisible(frankHost: FrankHostVitalsInput | null | undefined): boolean {
  return Boolean(frankHost);
}

export function frankHostVitalsLabel(frankHost: FrankHostVitalsInput): string {
  if (frankHost.stale) return 'stale';
  return frankHost.state;
}

export function frankHostVitalsDotTone(frankHost: FrankHostVitalsInput): FrankHostVitalsDotTone {
  if (frankHost.stale) return 'warn';
  if (frankHost.state === 'healthy') return 'ok';
  if (frankHost.state === 'degraded') return 'bad';
  return 'warn';
}