import { NextResponse } from 'next/server';

export async function GET() {
  const db = Boolean(process.env.DATABASE_URL);
  const redis = Boolean(process.env.REDIS_URL);
  const mode = process.env.SIGNALDESK_MODE ?? 'test';
  return NextResponse.json({
    ok: true,
    service: 'signaldesk',
    stage: 1,
    mode,
    dependencies: {
      databaseConfigured: db,
      redisConfigured: redis,
    },
  });
}