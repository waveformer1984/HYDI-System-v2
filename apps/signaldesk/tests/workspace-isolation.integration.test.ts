import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerUserWithWorkspace } from '@/lib/workspace/create';
import { requireMembership, WorkspaceAccessError } from '@/lib/workspace/access';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('workspace isolation (integration)', () => {
  it('denies cross-workspace access', async () => {
    const suffix = randomUUID().slice(0, 8);
    const a = await registerUserWithWorkspace({
      name: 'Alice',
      email: `alice-${suffix}@example.test`,
      password: 'password123',
      agencyName: `Agency A ${suffix}`,
    });
    const b = await registerUserWithWorkspace({
      name: 'Bob',
      email: `bob-${suffix}@example.test`,
      password: 'password123',
      agencyName: `Agency B ${suffix}`,
    });

    await expect(requireMembership(a.user.id, b.workspace.id)).rejects.toBeInstanceOf(WorkspaceAccessError);
    const membership = await requireMembership(a.user.id, a.workspace.id);
    expect(membership.workspace.id).toBe(a.workspace.id);
  });
});