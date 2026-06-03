import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const data = await request.json();
    console.log('[TEST-UPDATE] Received:', data);
    
    return NextResponse.json({ 
      success: true,
      received: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[TEST-UPDATE] Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
