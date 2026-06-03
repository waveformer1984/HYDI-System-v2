import { NextResponse } from 'next/server';
import { protoIStore } from '@/lib/protoi/store';

protoIStore.init();

export async function GET(): Promise<NextResponse> {
  const templates = Array.from(protoIStore.templates.values());
  return NextResponse.json({ success: true, templates });
}
