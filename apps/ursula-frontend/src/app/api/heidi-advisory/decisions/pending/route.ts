import { proxyHeidiAdvisory } from '@/lib/heidi-advisory-proxy';

export async function GET() {
  return proxyHeidiAdvisory('/api/decisions/pending', { method: 'GET' });
}
