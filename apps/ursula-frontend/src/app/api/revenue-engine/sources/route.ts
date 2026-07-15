import { NextRequest, NextResponse } from 'next/server';
import { createSource, listSources } from '@/lib/revenue-engine/engine';
import { SourceType } from '@/lib/revenue-engine/types';

const SOURCE_TYPES: SourceType[] = ['api', 'scrape', 'email', 'webhook'];

export async function GET(): Promise<NextResponse> {
  try {
    const sources = await listSources();
    return NextResponse.json({ sources });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SOURCES] Failed to list sources:', error);
    return NextResponse.json({ error: 'Failed to list sources' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (!body?.type || !SOURCE_TYPES.includes(body.type as SourceType)) {
      return NextResponse.json(
        { error: `Invalid source type. Expected one of: ${SOURCE_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const source = await createSource({
      type: body.type as SourceType,
      config: body.config || {},
      active: typeof body.active === 'boolean' ? body.active : true,
    });

    return NextResponse.json({ success: true, source }, { status: 201 });
  } catch (error) {
    console.error('[REVENUE_ENGINE][SOURCES] Failed to create source:', error);
    return NextResponse.json({ error: 'Failed to create source' }, { status: 500 });
  }
}
