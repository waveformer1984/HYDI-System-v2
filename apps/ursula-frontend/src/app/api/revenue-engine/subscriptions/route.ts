import { NextRequest, NextResponse } from 'next/server';
import { loadRevenueState, nowIso, saveRevenueState, generateId } from '@/lib/revenue-engine/storage';
import { Subscription } from '@/lib/revenue-engine/types';

const PLAN_SET = new Set(['starter', 'pro', 'premium']);
const STATUS_SET = new Set(['active', 'inactive', 'past_due', 'cancelled']);

export async function GET(): Promise<NextResponse> {
  try {
    const state = await loadRevenueState();
    return NextResponse.json({ subscriptions: state.subscriptions });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SUBSCRIPTIONS] Failed to list subscriptions:', error);
    return NextResponse.json({ error: 'Failed to list subscriptions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (typeof body?.user_id !== 'string' || !body.user_id.trim()) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const plan = typeof body.plan === 'string' ? body.plan : 'starter';
    if (!PLAN_SET.has(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const status = typeof body.status === 'string' ? body.status : 'active';
    if (!STATUS_SET.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const state = await loadRevenueState();
    const subscription: Subscription = {
      id: generateId(),
      user_id: body.user_id.trim(),
      plan: plan as Subscription['plan'],
      status: status as Subscription['status'],
      created_at: nowIso(),
    };

    state.subscriptions.push(subscription);
    state.activity.push({
      id: generateId(),
      type: 'subscription_created',
      payload: {
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan: subscription.plan,
      },
      created_at: nowIso(),
    });
    await saveRevenueState(state);

    return NextResponse.json({ success: true, subscription }, { status: 201 });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SUBSCRIPTIONS] Failed to create subscription:', error);
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
  }
}
