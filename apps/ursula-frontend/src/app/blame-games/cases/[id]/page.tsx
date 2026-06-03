'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Evidence {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  agentId?: string;
}

interface Vote {
  userId: string;
  verdict: string;
  stake: number;
  timestamp: string;
}

interface CaseDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  creatorId: string;
  assigneeId?: string;
  evidence: Evidence[];
  votes: Vote[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export default function CaseDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch('/api/blame-games/cases')
      .then(r => r.json())
      .then(data => {
        const found = data.cases?.find((c: CaseDetail) => c.id === id);
        if (found) setCaseData(found);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const guiltyCount = caseData?.votes.filter(v => v.verdict === 'guilty').length || 0;
  const innocentCount = caseData?.votes.filter(v => v.verdict === 'innocent').length || 0;
  const totalStake = caseData?.votes.reduce((sum, v) => sum + v.stake, 0) || 0;

  const statusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'voting': return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
      case 'resolved': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'appealed': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <div className="mb-6">
        <Link href="/blame-games" className="text-xs text-neutral-500 hover:text-rose-400 transition-colors uppercase tracking-wider">
          Back to Audit Matrix
        </Link>
      </div>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading case file...</div>
      ) : !caseData ? (
        <div className="text-neutral-500 text-center py-20">Case not found.</div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="border-b border-neutral-800 pb-6">
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${statusColor(caseData.status)}`}>
                {caseData.status}
              </span>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{caseData.category.replace('_', ' ')}</span>
            </div>
            <h1 className="text-2xl font-black text-neutral-100">{caseData.title}</h1>
            <p className="text-sm text-neutral-400 mt-2 leading-relaxed">{caseData.description}</p>
          </div>

          <div>
            <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">Evidence Chain</h2>
            <div className="space-y-3">
              {caseData.evidence.map(ev => (
                <div key={ev.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">{ev.type}</span>
                    {ev.agentId && <span className="text-[10px] text-neutral-500">agent: {ev.agentId}</span>}
                  </div>
                  <div className="text-sm text-neutral-300 font-mono bg-neutral-950 rounded p-3 border border-neutral-800">
                    {ev.content}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">Jury Verdicts</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-center">
                <div className="text-2xl font-black text-rose-400">{guiltyCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-1">Guilty</div>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-center">
                <div className="text-2xl font-black text-emerald-400">{innocentCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-1">Innocent</div>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-center">
                <div className="text-2xl font-black text-violet-400">{totalStake}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-1">Reputation Staked</div>
              </div>
            </div>
            <div className="space-y-2">
              {caseData.votes.map((vote, i) => (
                <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 flex items-center justify-between">
                  <div className="text-sm text-neutral-300">{vote.userId}</div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                      vote.verdict === 'guilty' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                    }`}>
                      {vote.verdict}
                    </span>
                    <span className="text-xs text-neutral-500">{vote.stake} pts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {caseData.resolution && (
            <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-xl p-6">
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-2">Resolution</h2>
              <p className="text-sm text-neutral-300">{caseData.resolution}</p>
              {caseData.resolvedAt && (
                <div className="text-xs text-neutral-500 mt-2">Resolved {new Date(caseData.resolvedAt).toLocaleDateString()}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
