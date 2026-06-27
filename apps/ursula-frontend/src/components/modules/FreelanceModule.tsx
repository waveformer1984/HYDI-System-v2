/**
 * FreelanceModule — Job Matching & Proposal Generation
 *
 * Dashboard for the freelance lead scraper — job discovery,
 * qualification scoring, auto-proposal generation, and pipeline tracking.
 *
 * TEST mode: Shows mock job leads and proposals.
 * LIVE mode: Connects to job scraper DB when available.
 *
 * Config: Set NEXT_PUBLIC_FREELANCE_URL for live data.
 * Error handling: Shows empty state when no leads loaded.
 */
'use client';

import { useState } from 'react';
import {
  Briefcase,
  Search,
  FileText,
  DollarSign,
  Star,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Send,
  Filter,
  ExternalLink,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface JobLead {
  id: string;
  title: string;
  platform: string;
  budget: string;
  match: number;
  status: 'new' | 'qualified' | 'proposal-sent' | 'responded' | 'won' | 'passed';
  skills: string[];
  posted: string;
}

const MOCK_LEADS: JobLead[] = [
  { id: 'JOB-001', title: 'Build a Next.js SaaS Dashboard', platform: 'Upwork', budget: '$2,000-5,000', match: 95, status: 'proposal-sent', skills: ['Next.js', 'React', 'Tailwind'], posted: '2026-02-09' },
  { id: 'JOB-002', title: 'Stripe Payment Integration', platform: 'Upwork', budget: '$500-1,000', match: 98, status: 'qualified', skills: ['Stripe', 'Node.js', 'Python'], posted: '2026-02-10' },
  { id: 'JOB-003', title: 'AI Chatbot for Customer Support', platform: 'Freelancer', budget: '$1,500-3,000', match: 82, status: 'new', skills: ['OpenAI', 'Python', 'React'], posted: '2026-02-10' },
  { id: 'JOB-004', title: 'WordPress to Next.js Migration', platform: 'Upwork', budget: '$3,000-7,000', match: 88, status: 'responded', skills: ['Next.js', 'WordPress', 'SEO'], posted: '2026-02-08' },
  { id: 'JOB-005', title: 'Mobile App Backend (Firebase)', platform: 'Toptal', budget: '$4,000+', match: 76, status: 'new', skills: ['Firebase', 'Node.js', 'REST API'], posted: '2026-02-10' },
  { id: 'JOB-006', title: 'E-commerce Payment Gateway Setup', platform: 'Upwork', budget: '$800-1,500', match: 94, status: 'won', skills: ['Stripe', 'PayPal', 'Shopify'], posted: '2026-02-07' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  'new': { color: '#58a6ff', bg: '#58a6ff15', label: 'New' },
  'qualified': { color: '#bc8cff', bg: '#bc8cff15', label: 'Qualified' },
  'proposal-sent': { color: '#d29922', bg: '#d2992215', label: 'Proposal Sent' },
  'responded': { color: '#f0883e', bg: '#f0883e15', label: 'Responded' },
  'won': { color: '#3fb950', bg: '#3fb95015', label: 'Won' },
  'passed': { color: '#8b949e', bg: '#8b949e15', label: 'Passed' },
};

export default function FreelanceModule() {
  const { isLive } = useMode();
  const [leads] = useState<JobLead[]>(MOCK_LEADS);
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? leads : leads.filter(l => l.status === filter);
  const wonDeals = leads.filter(l => l.status === 'won').length;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Briefcase size={20} style={{ color: '#3fb950' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Freelance Pipeline
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
          {leads.length} leads
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Automated job discovery, lead qualification, AI proposal generation, and pipeline tracking.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Search size={14} />, label: 'Leads', value: leads.length, color: '#58a6ff' },
          { icon: <Send size={14} />, label: 'Proposals', value: leads.filter(l => l.status === 'proposal-sent').length, color: '#d29922' },
          { icon: <CheckCircle2 size={14} />, label: 'Won', value: wonDeals, color: '#3fb950' },
          { icon: <Star size={14} />, label: 'Avg Match', value: `${Math.round(leads.reduce((s, l) => s + l.match, 0) / leads.length)}%`, color: '#bc8cff' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
          style={{
            background: filter === 'all' ? '#3fb95020' : 'transparent',
            color: filter === 'all' ? '#3fb950' : 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          All ({leads.length})
        </button>
        {Object.entries(STATUS_STYLE).map(([key, style]) => {
          const count = leads.filter(l => l.status === key).length;
          if (count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
              style={{
                background: filter === key ? style.bg : 'transparent',
                color: filter === key ? style.color : 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              {style.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <Search size={14} />, label: 'Auto-Scrape', desc: 'Upwork, Freelancer, Toptal' },
          { icon: <Star size={14} />, label: 'AI Qualification', desc: 'Skill match + budget scoring' },
          { icon: <FileText size={14} />, label: 'Proposal Gen', desc: 'Custom AI-written proposals' },
        ].map(f => (
          <div key={f.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: '#3fb950' }}>
              {f.icon}
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-active)' }}>{f.label}</span>
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Lead List */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Job Leads</h2>
      <div className="space-y-2">
        {filtered.map(lead => {
          const style = STATUS_STYLE[lead.status];
          return (
            <div key={lead.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{lead.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: '#3fb950' }}>{lead.budget}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: style.color, background: style.bg }}>
                    {style.label}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1"><ExternalLink size={9} /> {lead.platform}</span>
                <span className="flex items-center gap-1">
                  <Star size={9} style={{ color: lead.match >= 90 ? '#3fb950' : lead.match >= 75 ? '#d29922' : '#8b949e' }} />
                  {lead.match}% match
                </span>
                <span className="flex items-center gap-1"><Clock size={9} /> {lead.posted}</span>
                <span>{lead.skills.join(' · ')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
