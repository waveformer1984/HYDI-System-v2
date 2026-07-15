export type GameType = 'decision' | 'strategy' | 'puzzle';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

export interface GameMove {
  id: number;
  action: string;
  result: string;
  timestamp: string;
}

export interface GameSession {
  id: string;
  gameType: GameType;
  difficulty: Difficulty;
  playerId: string;
  aiOpponent: boolean;
  status: GameStatus;
  score: number;
  moves: GameMove[];
  startTime: string;
  endTime?: string;
  outcome: string;
}

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  totalScore: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  bestGameType: string;
  rank: number;
}
