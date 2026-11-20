import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { requireDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function credentialsProvider() {
  return Credentials({
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);
      if (!parsed.success) {
        return null;
      }
      const database = requireDb();
      const [row] = await database
        .select()
        .from(users)
        .where(eq(users.email, parsed.data.email.toLowerCase()))
        .limit(1);
      if (!row?.passwordHash) {
        return null;
      }
      const ok = await bcrypt.compare(parsed.data.password, row.passwordHash);
      if (!ok) {
        return null;
      }
      return {
        id: row.id,
        email: row.email,
        name: row.name ?? undefined,
      };
    },
  });
}