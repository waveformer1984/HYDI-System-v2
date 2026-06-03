import { randomUUID } from 'crypto';
import { Redis } from '@upstash/redis';
import { RevenueEngineState } from './types';

const STATE_KEY = 'revenue-engine:state:v1';
const STATE_FILE = './data/revenue-engine-state.json';

let redis: Redis | null = null;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (redisUrl && redisToken) {
  try {
    redis = Redis.fromEnv();
  } catch {
    console.warn('[REVENUE_ENGINE] Redis unavailable, using file fallback');
  }
}

function createEmptyState(): RevenueEngineState {
  return {
    sources: [],
    submissions: [],
    offers: [],
    deliveries: [],
    products: [],
    subscriptions: [],
    activity: [],
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function generateId(): string {
  return randomUUID();
}

export async function loadRevenueState(): Promise<RevenueEngineState> {
  if (redis) {
    try {
      const stored = await redis.get<Record<string, unknown> | string | null>(STATE_KEY);
      if (!stored) {
        return createEmptyState();
      }

      if (typeof stored === 'string') {
        return JSON.parse(stored) as RevenueEngineState;
      }

      return stored as unknown as RevenueEngineState;
    } catch (error) {
      console.error('[REVENUE_ENGINE] Failed to load state from Redis:', error);
    }
  }

  try {
    const fs = await import('fs/promises');
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as RevenueEngineState;
  } catch {
    return createEmptyState();
  }
}

export async function saveRevenueState(state: RevenueEngineState): Promise<void> {
  if (redis) {
    try {
      await redis.set(STATE_KEY, JSON.stringify(state));
      return;
    } catch (error) {
      console.error('[REVENUE_ENGINE] Failed to save state to Redis:', error);
    }
  }

  const fs = await import('fs/promises');
  await fs.mkdir('./data', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
