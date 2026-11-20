import type { NextAuthConfig } from 'next-auth';

/** Edge-safe auth config (no database imports). */
export const authConfig: NextAuthConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/sign-in',
    newUser: '/onboarding',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  trustHost: true,
};