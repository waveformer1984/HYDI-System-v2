import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { WorkspaceAccessError, requireMembership } from '@/lib/workspace/access';

type Params = { params: { workspaceId: string } };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const membership = await requireMembership(userId, params.workspaceId);
    return NextResponse.json({
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        demoMode: membership.workspace.demoMode,
      },
      role: membership.role,
    });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
}