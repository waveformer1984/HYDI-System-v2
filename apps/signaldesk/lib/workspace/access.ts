import { and, eq } from 'drizzle-orm';
import { requireDb, withWorkspaceContext } from '@/lib/db/client';
import { memberships, workspaces } from '@/lib/db/schema';

export type MembershipRole = 'owner' | 'admin' | 'member';

export class WorkspaceAccessError extends Error {
  readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND';

  constructor(code: WorkspaceAccessError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Resolve membership from authenticated user — never trust client workspace id alone. */
export async function requireMembership(userId: string, workspaceId: string) {
  const database = requireDb();
  const [row] = await database
    .select({
      id: memberships.id,
      role: memberships.role,
      workspaceId: memberships.workspaceId,
      userId: memberships.userId,
      workspace: workspaces,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  if (!row) {
    throw new WorkspaceAccessError('FORBIDDEN', 'No access to this workspace');
  }
  return row;
}

export async function listWorkspacesForUser(userId: string) {
  const database = requireDb();
  return database
    .select({
      workspace: workspaces,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));
}

export async function assertWorkspaceReadable(userId: string, workspaceId: string) {
  return withWorkspaceContext(userId, workspaceId, async () => {
    const m = await requireMembership(userId, workspaceId);
    return m;
  });
}

export function roleAllowsAdmin(role: MembershipRole) {
  return role === 'owner' || role === 'admin';
}