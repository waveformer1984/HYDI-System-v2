/**
 * HYDI World State Manager
 *
 * Maintains a structured representation of observed reality.
 * Every observation includes timestamp, source, confidence, freshness, and correlation ID.
 * Stale observations are never treated as current reality.
 */

import { randomUUID } from 'crypto';
import type {
  Observation,
  ObservationCategory,
  ObservationFreshness,
  ObservationSource,
  WorldState,
} from './AdaptiveOperatorTypes';

const FRESHNESS_THRESHOLDS = {
  current: 5 * 1000,    // 5 seconds
  recent: 60 * 1000,    // 1 minute
  stale: 5 * 60 * 1000, // 5 minutes
  // expired: anything beyond stale
};

export class WorldStateManager {
  private state: WorldState;

  constructor() {
    this.state = {
      worldId: randomUUID(),
      observations: new Map(),
      lastUpdated: new Date().toISOString(),
      observationCount: 0,
    };
  }

  /**
   * Record an observation in the world state.
   */
  observe(observation: Omit<Observation, 'observationId' | 'freshness'> & {
    freshness?: ObservationFreshness;
  }): Observation {
    const now = Date.now();
    const timestamp = observation.timestamp || new Date().toISOString();

    // Compute freshness from timestamp
    const age = now - new Date(timestamp).getTime();
    let freshness: ObservationFreshness;
    if (observation.freshness) {
      freshness = observation.freshness;
    } else if (age <= FRESHNESS_THRESHOLDS.current) {
      freshness = 'current';
    } else if (age <= FRESHNESS_THRESHOLDS.recent) {
      freshness = 'recent';
    } else if (age <= FRESHNESS_THRESHOLDS.stale) {
      freshness = 'stale';
    } else {
      freshness = 'expired';
    }

    const full: Observation = {
      ...observation,
      observationId: randomUUID(),
      timestamp,
      freshness,
    };

    this.state.observations.set(full.key, full);
    this.state.observationCount = this.state.observations.size;
    this.state.lastUpdated = new Date().toISOString();
    return full;
  }

  /**
   * Get an observation by key.
   * Returns null if not found or expired.
   */
  get(key: string): Observation | null {
    const obs = this.state.observations.get(key);
    if (!obs) return null;
    // Check freshness
    this.updateFreshness(obs);
    if (obs.freshness === 'expired' && obs.expiresAt) {
      const expired = new Date(obs.expiresAt).getTime() < Date.now();
      if (expired) return null;
    }
    return obs;
  }

  /**
   * Get all observations of a category.
   */
  getByCategory(category: ObservationCategory): Observation[] {
    const result: Observation[] = [];
    for (const obs of this.state.observations.values()) {
      if (obs.category === category) {
        this.updateFreshness(obs);
        result.push(obs);
      }
    }
    return result;
  }

  /**
   * Get all current or recent observations.
   */
  getCurrent(): Observation[] {
    const result: Observation[] = [];
    for (const obs of this.state.observations.values()) {
      this.updateFreshness(obs);
      if (obs.freshness === 'current' || obs.freshness === 'recent') {
        result.push(obs);
      }
    }
    return result;
  }

  /**
   * Check if an observation is fresh enough to act on.
   */
  isFresh(key: string, maxAgeSeconds?: number): boolean {
    const obs = this.state.observations.get(key);
    if (!obs) return false;
    this.updateFreshness(obs);
    if (obs.freshness === 'expired') return false;
    if (maxAgeSeconds !== undefined) {
      const age = Date.now() - new Date(obs.timestamp).getTime();
      return age <= maxAgeSeconds * 1000;
    }
    return obs.freshness === 'current' || obs.freshness === 'recent';
  }

  /**
   * Remove expired observations.
   */
  prune(): number {
    let removed = 0;
    for (const [key, obs] of this.state.observations) {
      this.updateFreshness(obs);
      if (obs.freshness === 'expired') {
        if (obs.expiresAt && new Date(obs.expiresAt).getTime() < Date.now()) {
          this.state.observations.delete(key);
          removed++;
        }
      }
    }
    this.state.observationCount = this.state.observations.size;
    return removed;
  }

  /**
   * Get the full world state snapshot.
   */
  getWorldState(): WorldState {
    return {
      ...this.state,
      observations: new Map(this.state.observations),
    };
  }

  /**
   * Clear all observations.
   */
  clear(): void {
    this.state.observations.clear();
    this.state.observationCount = 0;
    this.state.lastUpdated = new Date().toISOString();
  }

  /**
   * Get a summary of the world state.
   */
  summarize(): string {
    const categories: Record<string, number> = {};
    let current = 0, recent = 0, stale = 0, expired = 0;
    for (const obs of this.state.observations.values()) {
      this.updateFreshness(obs);
      categories[obs.category] = (categories[obs.category] ?? 0) + 1;
      if (obs.freshness === 'current') current++;
      else if (obs.freshness === 'recent') recent++;
      else if (obs.freshness === 'stale') stale++;
      else expired++;
    }
    return `WorldState: ${this.state.observationCount} observations ` +
      `(current: ${current}, recent: ${recent}, stale: ${stale}, expired: ${expired}). ` +
      `Categories: ${Object.entries(categories).map(([k, v]) => `${k}=${v}`).join(', ')}`;
  }

  /**
   * Update the freshness of an observation based on its age.
   */
  private updateFreshness(obs: Observation): void {
    const age = Date.now() - new Date(obs.timestamp).getTime();
    if (age <= FRESHNESS_THRESHOLDS.current) {
      obs.freshness = 'current';
    } else if (age <= FRESHNESS_THRESHOLDS.recent) {
      obs.freshness = 'recent';
    } else if (age <= FRESHNESS_THRESHOLDS.stale) {
      obs.freshness = 'stale';
    } else {
      obs.freshness = 'expired';
    }
  }
}
