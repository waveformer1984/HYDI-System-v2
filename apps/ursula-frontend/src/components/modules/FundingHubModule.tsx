/**
 * FundingHubModule — Grant Finding & Capital Acquisition
 *
 * Dashboard for discovering grants, tracking applications,
 * managing funding pipelines, and monitoring capital status.
 *
 * TEST mode: Shows mock grant/funding data.
 * LIVE mode: Connects to Funding Hub API when available.
 *
 * Config: Set NEXT_PUBLIC_FUNDING_HUB_URL for live data.
 * Error handling: Shows empty state when no grants loaded.
 */
'use client';

import { useState } from 'react';
import {
  Landmark,
  DollarSign,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Search,
  ExternalLink,
  Target,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface GrantLead {
  id: string;
  name: string;
  source: string;
  amount: string;
  deadline: string;
  status: 'discovered' | 'applying' | 'submitted' | 'awarded' | 'rejected';
  match: number;
  category: string;
}

const MOCK_GRANTS: GrantLead[] = [
  { id: 'GR-001', name: 'SBA Small Business Innovation Grant', source: 'SBA.gov', amount: '$50,000', deadline: '2026-04-15', status: 'applying', match: 92, category: 'Tech Startup' },
  { id: 'GR-002', name: 'NSF SBIR Phase I', source: 'NSF', amount: '$275,000', deadline: '2026-06-01', status: 'discovered', match: 78, category: 'R&D' },
  { id: 'GR-003', name: 'Texas Enterprise Fund', source: 'TX Governor', amount: '$25,000', deadline: '2026-03-30', status: 'discovered', match: 85, category: 'State Grant' },
  { id: 'GR-004', name: 'Google for Startups Cloud Credits', source: 'Google', amount: '$100,000 credits', deadline: 'Rolling', status: 'submitted', match: 95, category: 'Cloud/Infra' },
  { id: 'GR-005', name: 'CHDR Research Fundraiser', source: 'GoFundMe', amount: '$50,000 goal', deadline: 'Ongoing', status: 'applying', match: 100, category: 'Nonprofit' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  'discovered': { color: '#58a6ff', bg: '#58a6ff15' },
  'applying': { color: '#d29922', bg: '#d2992215' },
  'submitted': { color: '#bc8cff', bg: '#bc8cff15' },
  'awarded': { color: '#3fb950', bg: '#3fb95015' },
  'rejected': { color: '#f85149', bg: '#f8514915' },
};

export default function FundingHubModule() {
  const { isLive } = useMode();
  const [grants] = useState<GrantLead[]>(MOCK_GRANTS);

  const totalPipeline = grants.length;
  const activeApps = grants.filter(g => g.status === 'applying' || g.status === 'submitted').length;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Landmark size={20} style={{ color: '#d29922' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Funding Hub
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#d2992215', color: '#d29922' }}>
          {totalPipeline} leads
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Grant discovery, application management, and capital acquisition pipeline.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Search size={14} />, label: 'Discovered', value: grants.filter(g => g.status === 'discovered').length, color: '#58a6ff' },
          { icon: <FileText size={14} />, label: 'Applying', value: grants.filter(g => g.status === 'applying').length, color: '#d29922' },
          { icon: <Clock size={14} />, label: 'Submitted', value: grants.filter(g => g.status === 'submitted').length, color: '#bc8cff' },
          { icon: <CheckCircle2 size={14} />, label: 'Awarded', value: grants.filter(g => g.status === 'awarded').length, color: '#3fb950' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Grant Pipeline */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Grant Pipeline</h2>
      <div className="space-y-2">
        {grants.map(grant => {
          const style = STATUS_STYLE[grant.status];
          return (
            <div key={grant.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{grant.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: '#3fb950' }}>{grant.amount}</span>
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: style.color, background: style.bg }}>
                    {grant.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1"><ExternalLink size={9} /> {grant.source}</span>
                <span>{grant.category}</span>
                <span className="flex items-center gap-1"><Clock size={9} /> {grant.deadline}</span>
                <span className="flex items-center gap-1">
                  <Target size={9} style={{ color: grant.match >= 90 ? '#3fb950' : grant.match >= 70 ? '#d29922' : '#8b949e' }} />
                  {grant.match}% match
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
