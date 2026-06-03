import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';

const EXECUTIONS_FILE = './data/ursula-executions.json';
const PAYMENT_INTENTS_FILE = './data/ursula-payment-intents.json';

export interface UrsulaExecutionRecord {
  id: string;
  user_id: string;
  idempotency_key: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  cost: number;
  ledger_entry_id: string;
  result?: Record<string, unknown>;
  error?: string;
  started_at: string;
  completed_at?: string;
  trace_id: string;
}

export interface UrsulaPaymentIntentRecord {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'consumed' | 'failed';
  client_secret: string;
  created_at: string;
  updated_at: string;
  trace_id: string;
}

interface ExecutionStoreShape {
  executions: UrsulaExecutionRecord[];
}

interface PaymentIntentStoreShape {
  payment_intents: UrsulaPaymentIntentRecord[];
}

async function ensureDataDir(): Promise<void> {
  await mkdir('./data', { recursive: true });
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDataDir();
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function saveExecutionRecord(record: UrsulaExecutionRecord): Promise<void> {
  const store = await readJsonFile<ExecutionStoreShape>(EXECUTIONS_FILE, { executions: [] });
  const existingIndex = store.executions.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) {
    store.executions[existingIndex] = record;
  } else {
    store.executions.push(record);
  }
  await writeJsonFile(EXECUTIONS_FILE, store);
}

export async function getExecutionRecordById(executionId: string): Promise<UrsulaExecutionRecord | null> {
  const store = await readJsonFile<ExecutionStoreShape>(EXECUTIONS_FILE, { executions: [] });
  return store.executions.find((item) => item.id === executionId) || null;
}

export async function getExecutionRecordByIdForUser(
  executionId: string,
  userId: string
): Promise<UrsulaExecutionRecord | null> {
  const store = await readJsonFile<ExecutionStoreShape>(EXECUTIONS_FILE, { executions: [] });
  return (
    store.executions.find((item) => item.id === executionId && item.user_id === userId) || null
  );
}

export async function findExecutionByIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<UrsulaExecutionRecord | null> {
  const store = await readJsonFile<ExecutionStoreShape>(EXECUTIONS_FILE, { executions: [] });
  return (
    store.executions.find(
      (item) => item.user_id === userId && item.idempotency_key === idempotencyKey
    ) || null
  );
}

export async function savePaymentIntentRecord(record: UrsulaPaymentIntentRecord): Promise<void> {
  const store = await readJsonFile<PaymentIntentStoreShape>(PAYMENT_INTENTS_FILE, {
    payment_intents: [],
  });
  const existingIndex = store.payment_intents.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) {
    store.payment_intents[existingIndex] = record;
  } else {
    store.payment_intents.push(record);
  }
  await writeJsonFile(PAYMENT_INTENTS_FILE, store);
}

export async function getPaymentIntentRecordById(
  paymentIntentId: string
): Promise<UrsulaPaymentIntentRecord | null> {
  const store = await readJsonFile<PaymentIntentStoreShape>(PAYMENT_INTENTS_FILE, {
    payment_intents: [],
  });
  return store.payment_intents.find((item) => item.id === paymentIntentId) || null;
}

export async function getPaymentIntentRecordByIdForUser(
  paymentIntentId: string,
  userId: string
): Promise<UrsulaPaymentIntentRecord | null> {
  const store = await readJsonFile<PaymentIntentStoreShape>(PAYMENT_INTENTS_FILE, {
    payment_intents: [],
  });
  return (
    store.payment_intents.find((item) => item.id === paymentIntentId && item.user_id === userId) ||
    null
  );
}

export function createPaymentIntentRecord(params: {
  userId: string;
  amount: number;
  traceId: string;
  currency?: string;
}): UrsulaPaymentIntentRecord {
  const now = new Date().toISOString();
  return {
    id: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    user_id: params.userId,
    amount: params.amount,
    currency: params.currency || 'usd',
    status: 'created',
    client_secret: `pi_secret_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    created_at: now,
    updated_at: now,
    trace_id: params.traceId,
  };
}
