import { NextRequest, NextResponse } from 'next/server';
import { blameStore } from '@/lib/blame-games/store';

blameStore.init();

export async function GET(): Promise<NextResponse> {
  const cases = Array.from(blameStore.cases.values());
  return NextResponse.json({ success: true, cases });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const id = `case-${Date.now()}`;
    const newCase = {
      id,
      title: body.title || 'Untitled Case',
      description: body.description || '',
      category: body.category || 'other',
      status: 'open' as const,
      creatorId: body.creatorId || 'anonymous',
      assigneeId: body.assigneeId,
      evidence: body.evidence || [],
      votes: [],
      createdAt: new Date().toISOString(),
    };
    blameStore.cases.set(id, newCase);
    return NextResponse.json({ success: true, case: newCase }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
}
