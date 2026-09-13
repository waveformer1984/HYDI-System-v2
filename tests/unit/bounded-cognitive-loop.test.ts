/**
 * Bounded cognitive loop.
 *
 * A loop is only "bounded" if every await inside it is bounded. try/catch is
 * not enough: a promise that never settles never throws, so the catch never
 * runs and the cycle hangs forever.
 *
 * This was not hypothetical. Measured on 2026-09-08, Ollama answered
 * /api/tags and /api/ps in milliseconds while /api/embeddings and
 * /api/generate never returned at all — its model runner was wedged. Because
 * `generateEmbedding` used a bare `fetch` with no abort signal, and
 * `learnFromCycle` awaited it with no deadline, every cognitive cycle blocked
 * indefinitely on the memory write.
 *
 * These tests use a server that accepts connections and never answers, which
 * is exactly the failure that a "is the server up?" check cannot detect.
 */

import http from 'http';
import type { AddressInfo } from 'net';

import { generateEmbedding, embeddingTimeoutMs } from '../../lib/embeddings';
import { CognitiveCore } from '../../lib/heidi/CognitiveCore';
import { GoalSystem, type GoalStatus } from '../../lib/heidi/GoalSystem';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const TEST_PREFIX = `bounded_${Date.now()}`;

/** A server that accepts the connection and then never replies. */
function createBlackHoleServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const held: http.ServerResponse[] = [];
    const server = http.createServer((_req, res) => {
      // Deliberately never write, never end.
      held.push(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const res of held) res.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------

describe('embeddings are bounded', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('defaults to a budget far tighter than the generative model budget', () => {
    delete process.env.EMBEDDING_TIMEOUT_MS;
    expect(embeddingTimeoutMs()).toBe(15000);
    // LOCAL_MODEL_TIMEOUT_MS defaults to 60s for a cold 7B load. Reusing that
    // here would let one wedged runner cost a minute per cycle.
    expect(embeddingTimeoutMs()).toBeLessThan(60000);
  });

  it('honours EMBEDDING_TIMEOUT_MS', () => {
    process.env.EMBEDDING_TIMEOUT_MS = '750';
    expect(embeddingTimeoutMs()).toBe(750);
  });

  it('returns null instead of hanging when the provider never answers', async () => {
    const server = await createBlackHoleServer();
    try {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      process.env.LOCAL_MODEL_URL = server.url;
      process.env.EMBEDDING_TIMEOUT_MS = '400';

      const started = Date.now();
      const result = await generateEmbedding('a lesson worth remembering');
      const elapsed = Date.now() - started;

      // The contract callers already rely on: null means "no embedding",
      // which degrades to storing memory without semantic search.
      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(5000);
      expect(elapsed).toBeGreaterThanOrEqual(300);
    } finally {
      await server.close();
    }
  }, 20000);
});

describe('a cycle survives a memory subsystem that never returns', () => {
  const savedEnv = { ...process.env };
  let core: CognitiveCore | null = null;
  let goals: GoalSystem | null = null;

  afterEach(async () => {
    process.env = { ...savedEnv };
    if (core) {
      await core.close().catch(() => undefined);
      core = null;
    }
    if (goals) {
      await goals.close().catch(() => undefined);
      goals = null;
    }
  });

  it('completes the cycle and records the overrun rather than blocking', async () => {
    process.env.HEIDI_MEMORY_TIMEOUT_MS = '400';

    let retrieveCalled = false;
    let storeCalled = false;

    // The exact pathology: promises that never settle. Not rejections —
    // rejections were always survivable, because the try/catch caught them.
    const hangingMemory = {
      retrieve: (): Promise<string> => {
        retrieveCalled = true;
        return new Promise<string>(() => undefined);
      },
      storeExperience: (): Promise<boolean> => {
        storeCalled = true;
        return new Promise<boolean>(() => undefined);
      },
    };

    goals = new GoalSystem(DB_CONFIG);
    const mission = await goals.createGoal({
      goalType: 'mission',
      title: `${TEST_PREFIX}_hanging_memory`,
      priority: 10,
    });
    await goals.updateGoal(mission.goalId, { status: 'active' as GoalStatus });

    core = new CognitiveCore(DB_CONFIG, { memory: hangingMemory });

    const started = Date.now();
    const state = await core.runCycle();
    const elapsed = Date.now() - started;

    // Before the fix this never resolved at all: the qualification suite saw
    // it as a 120000ms test timeout.
    expect(state).not.toBeNull();
    expect(retrieveCalled).toBe(true);
    expect(elapsed).toBeLessThan(30000);

    // The overrun is recorded, not swallowed. A cycle that silently drops its
    // memory write looks identical to one that stored it.
    expect(state.errors.join(' ')).toContain('retrieve_memory exceeded');

    if (storeCalled) {
      expect(state.learningResult?.memoryStored).toBe(false);
    }

  }, 60000);
});
