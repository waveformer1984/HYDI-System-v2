import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { requireDb } from '@/lib/db/client';
import { auditLogs, memberships, users, workspaceProfiles, workspaces } from '@/lib/db/schema';

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base || 'workspace';
}

export async function registerUserWithWorkspace(input: {
  name: string;
  email: string;
  password: string;
  agencyName: string;
}) {
  const database = requireDb();
  const email = input.email.trim().toLowerCase();
  const existing = await database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    throw new Error('EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const [user] = await database
    .insert(users)
    .values({
      name: input.name.trim(),
      email,
      passwordHash,
    })
    .returning();

  const slugBase = slugify(input.agencyName);
  for (let i = 0; i < 5; i += 1) {
    const slug = i === 0 ? slugBase : `${slugBase}-${i}`;
    try {
      const [workspace] = await database
        .insert(workspaces)
        .values({
          name: input.agencyName.trim(),
          slug,
          demoMode: process.env.SIGNALDESK_MODE === 'demo',
        })
        .returning();

      await database.insert(memberships).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      });

      await database.insert(workspaceProfiles).values({
        workspaceId: workspace.id,
        agencyName: input.agencyName.trim(),
        targetLocations: ['Austin, TX'],
      });

      await database.insert(auditLogs).values({
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: workspace.id,
        metadata: { slug: workspace.slug },
      });

      return { user, workspace };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('unique') && !message.includes('duplicate')) {
        throw e;
      }
    }
  }
  throw new Error('SLUG_CONFLICT');
}