'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface CaseSummary {
  id: string;
  title: string;
  category: string;
  status: string;
  createdAt: string;
}

interface LeaderboardRow {
  userId: string;
  rank: number;
  handle: string;
  displayName: string;
  totalReputation: number;
  casesCorrect: number;
  casesTotal: number;
  winRate: number;
}

export default function BlameGamesDashboard() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/blame-games/cases').then(r => r.json()),
      fetch('/api/blame-games/leaderboard').then(r => r.json()),
    ]).then(([casesData, lbData]) => {
      if (casesData.cases) setCases(casesData.cases);
      if (lbData.leaderboard) setLeaderboard(lbData.leaderboard);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'voting': return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
      case 'resolved': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'appealed': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const categoryIcon = (cat: string) => {
    switch (cat) {
      case 'build_failure': return '🔥';
      case 'agent_error': return '🤖';
      case 'code_drift': return '📝';
      case 'workflow_block': return '🚧';
      default: return '❓';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-rose-400 to-orange-500">
          BLAME GAMES // AUDIT MATRIX
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Gamified attribution and codebase forensics</p>
      </header>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading audit matrix...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cases Panel */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-neutral-200">Active Cases</h2>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{cases.length} total</span>
            </div>

            <div className="space-y-3">
              {cases.map(c => (
                <Link
                  key={c.id}
                  href={`/blame-games/cases/${c.id}`}
                  className="block bg-neutral-900 border border-neutral-800 rounded-xl p-4 hover:border-rose-500/30 transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{categoryIcon(c.category)}</span>
                      <div>
                        <div className="text-sm font-semibold text-neutral-200 group-hover:text-rose-300 transition-colors">
                          {c.title}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5">
                          {c.category.replace('_', ' ')} · {new Date(c.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${statusColor(c.status)}`}>
                      {c.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Leaderboard Panel */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 h-fit">
            <h2 className="text-lg font-bold text-neutral-200 mb-4">Reputation Leaderboard</h2>
            <div className="space-y-3">
              {leaderboard.map(entry => (
                <div key={entry.userId} className="flex items-center gap-3">
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
                    <div className="text-[10px] text-neutral-500">@{entry.handle}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-rose-400">{entry.totalReputation.toLocaleString()}</div>
                    <div className="text-[10px] text-neutral-500">{entry.winRate}% accuracy</div>
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
