import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { loadHydiTasks } from '@/lib/hydi-task-store';

const URSULA_BASE_URL = process.env.URSULA_API_URL || 'http://localhost:3000';

// GET /api/tasks - Get all tasks with cross-system verification
export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    console.log('[TASKS] Fetching tasks with cross-system verification');

    // Get tasks from HYDI storage
    const hydiTasks = await fetchHydiTasks();

    // Cross-check each task with Ursula and Billing
    const verifiedTasks = await Promise.all(
      hydiTasks.map(async (task) => {
        const crossChecks = await performCrossChecks(task);
        return {
          ...task,
          crossChecks,
          verified: crossChecks.hydiExists && crossChecks.ursulaExists,
        };
      })
    );

    return NextResponse.json({
      success: true,
      tasks: verifiedTasks,
      timestamp: new Date().toISOString(),
      traceId,
    }, { headers: { 'x-trace-id': traceId } });

  } catch (error) {
    console.error('[TASKS] Failed to fetch tasks:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch tasks',
      details: error instanceof Error ? error.message : 'Unknown error',
      traceId,
    }, { status: 500, headers: { 'x-trace-id': traceId } });
  }
}

/**
 * Perform cross-system verification for a task
 */
async function performCrossChecks(task: any): Promise<{
  hydiExists: boolean;
  ursulaExists: boolean;
  billingExists: boolean;
  ursulaStatus?: string;
  billingStatus?: string;
}> {
  const checks = {
    hydiExists: true, // We got it from HYDI
    ursulaExists: false,
    billingExists: false,
    ursulaStatus: undefined,
    billingStatus: undefined,
  };

  // Check Ursula if task has execution ID
  if (task.ursula_execution_id) {
    try {
      const execution = await fetchUrsulaExecution(task.ursula_execution_id);
      checks.ursulaExists = true;
      checks.ursulaStatus = execution.status;
    } catch (error) {
      console.warn(`[TASKS] Failed to check Ursula execution ${task.ursula_execution_id}:`, error);
    }
  }

  // Check Billing if task has payment intent ID
  if (task.ursula_payment_intent_id) {
    try {
      const payment = await fetchBillingPayment(task.ursula_payment_intent_id);
      checks.billingExists = true;
      checks.billingStatus = payment.status;
    } catch (error) {
      console.warn(`[TASKS] Failed to check billing payment ${task.ursula_payment_intent_id}:`, error);
    }
  }

  return checks;
}

/**
 * Fetch tasks from HYDI system
 */
async function fetchHydiTasks(): Promise<any[]> {
  try {
    return await loadHydiTasks();
  } catch (error) {
    console.error('Failed to fetch HYDI tasks:', error);
    return [];
  }
}

/**
 * Fetch execution from Ursula system
 */
async function fetchUrsulaExecution(executionId: string): Promise<any> {
  try {
    const response = await fetch(`${URSULA_BASE_URL}/api/executions/${encodeURIComponent(executionId)}`);
    if (!response.ok) {
      throw new Error('Execution not found');
    }
    const payload = await response.json();
    return payload.execution || payload;
  } catch (error) {
    console.error(`Failed to fetch Ursula execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Fetch payment from billing system
 */
async function fetchBillingPayment(paymentIntentId: string): Promise<any> {
  try {
    const response = await fetch(`${URSULA_BASE_URL}/api/billing/${encodeURIComponent(paymentIntentId)}`);
    if (!response.ok) {
      throw new Error('Payment not found');
    }
    const payload = await response.json();
    return payload.payment || payload;
  } catch (error) {
    console.error(`Failed to fetch billing payment ${paymentIntentId}:`, error);
    throw error;
  }
}
