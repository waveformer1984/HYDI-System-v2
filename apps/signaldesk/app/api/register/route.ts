import { NextResponse } from 'next/server';
import { z } from 'zod';
import { registerUserWithWorkspace } from '@/lib/workspace/create';

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  agencyName: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  if (process.env.SIGNALDESK_MODE === 'demo' && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Registration disabled in public demo' }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { user, workspace } = await registerUserWithWorkspace(parsed.data);
    return NextResponse.json(
      {
        userId: user.id,
        workspaceId: workspace.id,
        slug: workspace.slug,
      },
      { status: 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message === 'EMAIL_TAKEN') {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    if (message === 'Database is not configured (DATABASE_URL)') {
      return NextResponse.json({ error: 'Server database not configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}