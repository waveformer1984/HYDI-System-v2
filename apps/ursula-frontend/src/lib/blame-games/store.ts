import { BlameUser, BlameCase, BlameBet, LeaderboardEntry } from './types';

// In-memory store — swap for SQLite/PostgreSQL when ready
class BlameStore {
  users: Map<string, BlameUser> = new Map();
  cases: Map<string, BlameCase> = new Map();
  bets: Map<string, BlameBet> = new Map();
  initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Seed demo users
    const now = new Date().toISOString();
    this.users.set('user-001', {
      id: 'user-001', handle: 'architect', displayName: 'System Architect',
      reputation: 1250, createdAt: now,
    });
    this.users.set('user-002', {
      id: 'user-002', handle: 'verifier_7', displayName: 'Verifier Seven',
      reputation: 890, createdAt: now,
    });
    this.users.set('user-003', {
      id: 'user-003', handle: 'proto_master', displayName: 'Proto Master',
      reputation: 2100, createdAt: now,
    });

    // Seed demo cases
    this.cases.set('case-001', {
      id: 'case-001',
      title: 'Hydi-ProtoForge build drift on 2026-06-01',
      description: 'Unexpected identifier in execution-agents.js caused PM2 crash loop. Root cause: mismatched quote in template literal.',
      category: 'build_failure',
      status: 'resolved',
      creatorId: 'user-001',
      assigneeId: 'user-002',
      evidence: [
        { id: 'ev-1', type: 'log', content: 'SyntaxError: Unexpected identifier \'Order\'', timestamp: now, agentId: 'hydi-protoforge' },
        { id: 'ev-2', type: 'commit', content: 'execution-agents.js:221 — mismatched backtick/single-quote', timestamp: now },
      ],
      votes: [
        { userId: 'user-002', verdict: 'guilty', stake: 50, timestamp: now },
        { userId: 'user-003', verdict: 'guilty', stake: 100, timestamp: now },
      ],
      createdAt: now,
      resolvedAt: now,
      resolution: 'Fixed by escaping template literal. Process restarted successfully.',
    });

    this.cases.set('case-002', {
      id: 'case-002',
      title: 'Heidi brain disconnected — Ollama not running',
      description: 'Health endpoint returned degraded status with brain: disconnected. No LLM provider available.',
      category: 'agent_error',
      status: 'resolved',
      creatorId: 'user-002',
      assigneeId: 'user-001',
      evidence: [
        { id: 'ev-3', type: 'log', content: '[HEIDI] Brain not available. Is Ollama running? (ollama serve)', timestamp: now },
      ],
      votes: [
        { userId: 'user-001', verdict: 'innocent', stake: 25, timestamp: now },
        { userId: 'user-003', verdict: 'innocent', stake: 75, timestamp: now },
      ],
      createdAt: now,
      resolvedAt: now,
      resolution: 'Started ollama serve. Heidi brain reconnected.',
    });

    this.cases.set('case-003', {
      id: 'case-003',
      title: 'Next.js 15 route handler type mismatches in UCMRS modules',
      description: 'Multiple PUT/DELETE handlers in App Router API routes had incompatible signatures with Next.js 15 params typing.',
      category: 'code_drift',
      status: 'resolved',
      creatorId: 'user-003',
      assigneeId: 'user-001',
      evidence: [
        { id: 'ev-4', type: 'commit', content: 'components/route.ts, modules/route.ts, protoboards/route.ts — params removed from handler args', timestamp: now },
      ],
      votes: [
        { userId: 'user-001', verdict: 'guilty', stake: 40, timestamp: now },
        { userId: 'user-002', verdict: 'guilty', stake: 60, timestamp: now },
      ],
      createdAt: now,
      resolvedAt: now,
      resolution: 'Removed params from handler signatures; extracted IDs from body/query instead.',
    });
  }

  getLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    for (const user of this.users.values()) {
      const userCases = Array.from(this.cases.values()).filter(c =>
        c.votes.some(v => v.userId === user.id)
      );
      const correct = userCases.filter(c => {
        const userVote = c.votes.find(v => v.userId === user.id);
        if (!userVote || c.status !== 'resolved') return false;
        // Simplified: majority guilty = guilty
        const guiltyCount = c.votes.filter(v => v.verdict === 'guilty').length;
        const innocentCount = c.votes.filter(v => v.verdict === 'innocent').length;
        const actual = guiltyCount > innocentCount ? 'guilty' : 'innocent';
        return userVote.verdict === actual;
      }).length;
      const total = userCases.filter(c => c.status === 'resolved').length;
      entries.push({
        userId: user.id,
        handle: user.handle,
        displayName: user.displayName,
        totalReputation: user.reputation,
        casesCorrect: correct,
        casesTotal: total,
        winRate: total > 0 ? Math.round((correct / total) * 100) : 0,
        rank: 0,
      });
    }
    entries.sort((a, b) => b.totalReputation - a.totalReputation);
    entries.forEach((e, i) => { e.rank = i + 1; });
    return entries;
  }
}

export const blameStore = new BlameStore();
