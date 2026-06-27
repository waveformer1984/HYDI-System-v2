'use client';

import React, { useEffect, useState } from 'react';

interface GameMove {
  id: number;
  action: string;
  result: string;
}

interface GameSession {
  id: string;
  gameType: string;
  difficulty: string;
  playerId: string;
  aiOpponent: boolean;
  status: string;
  score: number;
  moves: GameMove[];
  outcome: string;
}

interface LeaderboardRow {
  playerId: string;
  displayName: string;
  totalScore: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  rank: number;
}

export default function GamesLobby() {
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/games/sessions').then(r => r.json()),
      fetch('/api/games/leaderboard').then(r => r.json()),
    ]).then(([sessData, lbData]) => {
      if (sessData.sessions) setSessions(sessData.sessions);
      if (lbData.leaderboard) setLeaderboard(lbData.leaderboard);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const typeIcon = (type: string) => {
    switch (type) {
      case 'strategy': return '⚔️';
      case 'decision': return '🎯';
      case 'puzzle': return '🧩';
      default: return '🎮';
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'won': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'lost': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'playing': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const difficultyBadge = (d: string) => {
    switch (d) {
      case 'easy': return 'text-emerald-400';
      case 'medium': return 'text-amber-400';
      case 'hard': return 'text-rose-400';
      default: return 'text-neutral-500';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-fuchsia-500">
          GAMES // TACTICAL LOBBY
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Decision, strategy, and puzzle simulations with AI opponents</p>
      </header>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading game lobby...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sessions */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-neutral-200">Recent Sessions</h2>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{sessions.length} total</span>
            </div>

            <div className="space-y-3">
              {sessions.map(sess => (
                <div key={sess.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{typeIcon(sess.gameType)}</span>
                      <div>
                        <div className="text-sm font-semibold text-neutral-200 capitalize">{sess.gameType} Game</div>
                        <div className="text-xs text-neutral-500">
                          {sess.aiOpponent ? 'vs AI · ' : 'Solo · '}
                          <span className={difficultyBadge(sess.difficulty)}>{sess.difficulty}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${statusColor(sess.status)}`}>
                        {sess.status}
                      </span>
                      <div className="text-sm font-bold text-violet-400 mt-1">{sess.score} pts</div>
                    </div>
                  </div>

                  <div className="text-xs text-neutral-400 mb-2">Outcome: <span className="text-neutral-200">{sess.outcome}</span></div>

                  <div className="space-y-1.5">
                    {sess.moves.map(move => (
                      <div key={move.id} className="flex items-start gap-2 text-xs">
                        <span className="text-neutral-600 mt-0.5">{move.id}.</span>
                        <div>
                          <span className="text-neutral-300">{move.action}</span>
                          <span className="text-neutral-600 mx-1">→</span>
                          <span className="text-neutral-500">{move.result}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 h-fit">
            <h2 className="text-lg font-bold text-neutral-200 mb-4">Score Leaderboard</h2>
            <div className="space-y-3">
              {leaderboard.map(entry => (
                <div key={entry.playerId} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    entry.rank === 1 ? 'bg-yellow-500/20 text-yellow-400' :
                    entry.rank === 2 ? 'bg-neutral-300/20 text-neutral-300' :
                    entry.rank === 3 ? 'bg-orange-700/20 text-orange-400' :
                    'bg-neutral-800 text-neutral-500'
                  }`}>
                    {entry.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-200 truncate">{entry.displayName}</div>
                    <div className="text-[10px] text-neutral-500">{entry.gamesWon}/{entry.gamesPlayed} wins · {entry.winRate}%</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-violet-400">{entry.totalScore}</div>
                    <div className="text-[10px] text-neutral-500">pts</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
