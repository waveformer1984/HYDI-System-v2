import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { credentialsProvider } from './credentials-provider';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [credentialsProvider()],
});