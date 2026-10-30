/**
 * Portfolio registry — client-side shape for config/portfolio.json entries,
 * fetched via /api/portfolio. Replaces the retired hardcoded appRegistry.ts
 * (which pointed at the stale HYDI_System clone).
 */

export interface PortfolioApp {
  id: string;
  name: string;
  division: string;
  kind: 'local' | 'suite' | 'external';
  repoPath?: string;
  pm2Name?: string | null;
  port?: number | null;
  localUrl?: string | null;
  healthUrl?: string | null;
  suiteBase?: string | null;
  blueprintPath?: string;
  url?: string;
  devLogin?: { method: string; seed: string | null };
  stripeMode?: string;
  embeddable?: boolean;
  notEmbeddableReason?: string;
  pm2Candidate?: boolean;
  icon?: string;
  status?: string;
  description?: string;
}

export async function fetchPortfolio(): Promise<PortfolioApp[]> {
  const res = await fetch('/api/portfolio', { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json();
  if (!body.ok || !Array.isArray(body.apps)) return [];
  const suiteBase = body.suiteBase || 'http://localhost:5000';
  return body.apps.map((a: any) => ({
    ...a,
    // Card shape the launcher renders — url resolves per kind.
    url: a.kind === 'suite' ? `${suiteBase}${a.blueprintPath}` : a.localUrl || a.url || null,
    icon: a.icon || (a.kind === 'suite' ? '🧩' : a.division === 'core' ? '🏗️' : '📦'),
    status: a.status || 'active',
    description: a.description || `${a.division} · ${a.kind}${a.pm2Name ? ` · pm2:${a.pm2Name}` : ''}`,
    path: a.repoPath || a.blueprintPath || a.url || '',
    displayName: a.name,
  }));
}

export const DIVISIONS = [
  { id: 'core', name: 'Core', icon: '🏗️' },
  { id: 'protoforge', name: 'ProtoForge Apps', icon: '🛠️' },
  { id: 'apps', name: 'Apps', icon: '📦' },
  { id: 'ursula-suite', name: 'Ursula Suite', icon: '🧩' },
] as const;
