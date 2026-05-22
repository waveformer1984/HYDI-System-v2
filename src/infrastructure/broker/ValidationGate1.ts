/**
 * Validation Gate 1: Replay Integrity Test
 *
 * Test Objective:
 * Publish 1,000 distinct agent execution steps to hydi:tasks:routing.
 * Deliberately inject exception at message #500.
 * Verify that message #500 is cleanly routed to hydi:dlq:deadletter
 * while messages #501–1000 process with zero state interruption.
 *
 * Expected Outcome:
 * - 999 messages successfully acknowledged
 * - 1 message routed to DLQ with error context
 * - Zero message loss
 * - Zero replays of #501+
 */

import { RedisStreamBroker } from './RedisStreamBroker';
import { HYDIEvent } from './MessageBroker';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const REDIS_URL = 'redis://localhost:6379';
const TEST_TOPIC = 'hydi:tasks:routing';
const TEST_GROUP = 'validation-gate-1';
const TEST_CONSUMER = 'test-consumer-001';
const DLQ_TOPIC = 'hydi:dlq:deadletter';
const TOTAL_MESSAGES = 1000;
const FAILURE_MESSAGE_INDEX = 500;

interface TestResult {
  passed: boolean;
  duration: number;
  messagesProcessed: number;
  dlqMessages: number;
  errors: string[];
}

async function runValidationGate1(): Promise<TestResult> {
  const result: TestResult = {
    passed: false,
    duration: 0,
    messagesProcessed: 0,
    dlqMessages: 0,
    errors: []
  };

  const startTime = Date.now();
  const broker = new RedisStreamBroker(REDIS_URL);
  const redisClient = new Redis(REDIS_URL);
  const dlqClient = new Redis(REDIS_URL);

  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         VALIDATION GATE 1: REPLAY INTEGRITY             ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // ─────────────────────────────────────────────────────────────────
    // Phase 1: Connect to Redis and clear test streams
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 1] Connecting to Redis Streams broker...');
    await broker.connect();
    console.log('✓ Connected\n');

    // Clear previous test streams
    await redisClient.del(TEST_TOPIC);
    await dlqClient.del(DLQ_TOPIC);
    console.log('✓ Cleared test streams\n');

    // ─────────────────────────────────────────────────────────────────
    // Phase 2: Subscribe FIRST (group created at $ on empty stream)
    // Messages published after this point will be picked up by the
    // consumer. Subscribing after publish would create the group at $
    // (latest ID), missing all 1,000 already-queued messages.
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 2] Starting consumer BEFORE publish (group created at $ on empty stream)...');

    let processedCount = 0;
    let dlqRouted = false;

    await broker.subscribe(TEST_TOPIC, TEST_GROUP, TEST_CONSUMER, async (event: HYDIEvent) => {
      const stepNumber = event.payload.stepNumber as number;

      // Inject error at message #500
      if (stepNumber === FAILURE_MESSAGE_INDEX) {
        console.error(`  ! ERROR INJECTED at message #${stepNumber} (expected)`);
        throw new Error(`Intentional handler failure for validation at step ${stepNumber}`);
      }

      // Normal processing
      processedCount++;
      if (stepNumber % 100 === 0 || stepNumber === TOTAL_MESSAGES) {
        console.log(`  ✓ Processed message #${stepNumber} (total: ${processedCount})`);
      }
    });

    console.log('✓ Consumer subscribed and polling\n');

    // ─────────────────────────────────────────────────────────────────
    // Phase 3: Publish 1,000 test events — consumer is already waiting
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 3] Publishing 1,000 test events...');
    const publishedIds: string[] = [];

    for (let i = 1; i <= TOTAL_MESSAGES; i++) {
      const messageId = await broker.publish(TEST_TOPIC, {
        correlationId: uuidv4(),
        component: 'test-harness',
        payload: {
          stepNumber: i,
          executionId: `exec-${i}`,
          taskData: { priority: Math.random() > 0.5 ? 'high' : 'low' }
        }
      });

      publishedIds.push(messageId);

      if (i % 100 === 0) {
        console.log(`  → Published ${i}/${TOTAL_MESSAGES} messages`);
      }
    }

    console.log(`✓ Published ${TOTAL_MESSAGES} messages\n`);

    // Wait for all messages to be consumed.
    // With COUNT=1 and no block wait (messages available immediately),
    // 1,000 iterations at ~2–5 ms each takes ~2–5 s. Allow 15 s total.
    console.log('  → Waiting up to 15 s for message consumption...');
    const waitStart = Date.now();
    while (processedCount < TOTAL_MESSAGES - 1 && Date.now() - waitStart < 15000) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    // Additional 1 s grace for the DLQ publish to land
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ─────────────────────────────────────────────────────────────────
    // Phase 4: Verify DLQ routing
    // ─────────────────────────────────────────────────────────────────
    console.log('\n[Phase 4] Verifying Dead Letter Queue routing...');

    const dlqMessages = await dlqClient.xlen(DLQ_TOPIC);
    console.log(`  → DLQ message count: ${dlqMessages}`);

    if (dlqMessages > 0) {
      const dlqContent = await dlqClient.xrange(DLQ_TOPIC, '-', '+');
      for (const [id, fields] of dlqContent) {
        console.log(`  DLQ Entry [${id}]:`);
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === 'payload') {
            const payload = JSON.parse(fields[i + 1]);
            console.log(`    - Original Step: ${payload.originalEvent?.payload?.stepNumber}`);
            console.log(`    - Error: ${payload.errorMessage}`);
          }
        }
      }
      dlqRouted = dlqMessages > 0;
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 5: Validation assertions
    // ─────────────────────────────────────────────────────────────────
    console.log('\n[Phase 5] Running validation assertions...');

    const assertions = [
      {
        name: 'DLQ contains exactly 1 message',
        condition: dlqMessages === 1,
        expected: 1,
        actual: dlqMessages
      },
      {
        name: 'Failed message routed to DLQ',
        condition: dlqRouted,
        expected: true,
        actual: dlqRouted
      },
      {
        name: 'Processed count matches TOTAL_MESSAGES - 1',
        condition: processedCount === TOTAL_MESSAGES - 1,
        expected: TOTAL_MESSAGES - 1,
        actual: processedCount
      }
    ];

    let allAssertionsPassed = true;
    for (const assertion of assertions) {
      const status = assertion.condition ? '✓' : '✗';
      console.log(`  ${status} ${assertion.name}`);
      if (!assertion.condition) {
        console.log(`     Expected: ${assertion.expected}, Actual: ${assertion.actual}`);
        result.errors.push(`Assertion failed: ${assertion.name}`);
        allAssertionsPassed = false;
      }
    }

    result.messagesProcessed = processedCount;
    result.dlqMessages = dlqMessages;
    result.passed = allAssertionsPassed;

    // ─────────────────────────────────────────────────────────────────
    // Phase 6: Report and cleanup
    // ─────────────────────────────────────────────────────────────────
    console.log('\n[Phase 6] Reporting results...');

    result.duration = Date.now() - startTime;

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    if (result.passed) {
      console.log(`║  ✓ VALIDATION GATE 1 PASSED                            ║`);
    } else {
      console.log(`║  ✗ VALIDATION GATE 1 FAILED                            ║`);
    }
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Duration:           ${result.duration}ms`);
    console.log(`║  Messages Processed: ${result.messagesProcessed}/${TOTAL_MESSAGES}`);
    console.log(`║  DLQ Messages:       ${result.dlqMessages}`);
    console.log(`║  Errors:             ${result.errors.length}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    if (result.errors.length > 0) {
      console.log('Errors encountered:');
      result.errors.forEach(err => console.log(`  - ${err}`));
    }

    await broker.disconnect();
    await redisClient.quit();
    await dlqClient.quit();

    return result;
  } catch (error) {
    result.errors.push(`Fatal error: ${error}`);
    result.duration = Date.now() - startTime;
    console.error(`\n✗ VALIDATION GATE 1 FAILED WITH EXCEPTION:\n${error}\n`);

    try {
      await broker.disconnect();
      await redisClient.quit();
      await dlqClient.quit();
    } catch (cleanup) {
      // Ignore cleanup errors
    }

    return result;
  }
}

// Execute if run directly
if (require.main === module) {
  runValidationGate1().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export { runValidationGate1, TestResult };
