import { GameSession, LeaderboardEntry } from './types';

class GamesStore {
  sessions: Map<string, GameSession> = new Map();
  initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const now = new Date().toISOString();

    this.sessions.set('game-001', {
      id: 'game-001',
      gameType: 'strategy',
      difficulty: 'medium',
      playerId: 'user-001',
      aiOpponent: true,
      status: 'won',
      score: 72,
      moves: [
        { id: 1, action: 'Deploy scouts to flank', result: 'Discovered enemy weak point', timestamp: now },
        { id: 2, action: 'Execute pincer maneuver', result: 'Enemy forces split', timestamp: now },
        { id: 3, action: 'Consolidate center', result: 'Gained territorial control', timestamp: now },
        { id: 4, action: 'Final push', result: 'Victory — enemy surrendered', timestamp: now },
      ],
      startTime: now,
      endTime: now,
      outcome: 'Victory',
    });

    this.sessions.set('game-002', {
      id: 'game-002',
      gameType: 'decision',
      difficulty: 'hard',
      playerId: 'user-002',
      aiOpponent: true,
      status: 'lost',
      score: 45,
      moves: [
        { id: 1, action: 'Accept high-risk contract', result: 'Cash flow improved but liability increased', timestamp: now },
        { id: 2, action: 'Expand team rapidly', result: 'Quality control degraded', timestamp: now },
        { id: 3, action: 'Launch premature marketing', result: 'Reputation damage from buggy product', timestamp: now },
        { id: 4, action: 'Attempt damage control', result: 'Insufficient — game over', timestamp: now },
      ],
      startTime: now,
      endTime: now,
      outcome: 'Bankruptcy',
    });

    this.sessions.set('game-003', {
      id: 'game-003',
      gameType: 'puzzle',
      difficulty: 'easy',
      playerId: 'user-003',
      aiOpponent: false,
      status: 'won',
      score: 95,
      moves: [
        { id: 1, action: 'Identify pattern in row 3', result: 'Found key sequence', timestamp: now },
        { id: 2, action: 'Apply sequence to column 5', result: 'Block cleared', timestamp: now },
        { id: 3, action: 'Complete final alignment', result: 'Puzzle solved', timestamp: now },
      ],
      startTime: now,
      endTime: now,
      outcome: 'Solved',
    });
  }

  getLeaderboard(): LeaderboardEntry[] {
    const byPlayer = new Map<string, { displayName: string; totalScore: number; games: number; wins: number; bestType: string }>();

    for (const session of this.sessions.values()) {
      const entry = byPlayer.get(session.playerId) || {
        displayName: session.playerId === 'user-001' ? 'System Architect' :
                     session.playerId === 'user-002' ? 'Verifier Seven' : 'Proto Master',
        totalScore: 0, games: 0, wins: 0, bestType: session.gameType,
      };
      entry.totalScore += session.score;
      entry.games += 1;
      if (session.status === 'won') entry.wins += 1;
      byPlayer.set(session.playerId, entry);
    }

    const entries: LeaderboardEntry[] = [];
    for (const [playerId, data] of byPlayer) {
      entries.push({
        playerId,
        displayName: data.displayName,
        totalScore: data.totalScore,
        gamesPlayed: data.games,
        gamesWon: data.wins,
        winRate: data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0,
        bestGameType: data.bestType,
        rank: 0,
      });
    }

    entries.sort((a, b) => b.totalScore - a.totalScore);
    entries.forEach((e, i) => { e.rank = i + 1; });
    return entries;
  }
}

export const gamesStore = new GamesStore();
