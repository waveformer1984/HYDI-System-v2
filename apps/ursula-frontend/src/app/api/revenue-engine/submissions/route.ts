import { NextRequest, NextResponse } from 'next/server';
import { createSubmission, listOffers, listSubmissions } from '@/lib/revenue-engine/engine';

export async function GET(): Promise<NextResponse> {
  try {
    const [submissions, offers] = await Promise.all([listSubmissions(), listOffers()]);
    return NextResponse.json({ submissions, offers });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SUBMISSIONS] Failed to list submissions:', error);
    return NextResponse.json({ error: 'Failed to list submissions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (!body?.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const submission = await createSubmission({
      content: body.content,
      source: typeof body.source === 'string' ? body.source : 'manual',
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
    });

    if (!submission) {
      return NextResponse.json({ success: false, reason: 'duplicate_or_empty_submission' }, { status: 409 });
    }

    return NextResponse.json({ success: true, submission }, { status: 201 });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SUBMISSIONS] Failed to create submission:', error);
    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}
