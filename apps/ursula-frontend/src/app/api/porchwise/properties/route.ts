import { NextResponse } from 'next/server';
import { porchwiseStore } from '@/lib/porchwise/store';

porchwiseStore.init();

export async function GET(): Promise<NextResponse> {
  const properties = Array.from(porchwiseStore.properties.values());
  return NextResponse.json({ success: true, properties });
}
