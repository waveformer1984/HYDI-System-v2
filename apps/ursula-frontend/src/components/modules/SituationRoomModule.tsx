/**
 * SituationRoomModule — Roadmap visualizer and strategic timeline
 * 
 * Visual timeline of milestones, phases, and deliverables.
 * Shows current position, upcoming targets, and blockers.
 * 
 * Config: Replace ROADMAP_DATA with API-driven data when available.
 * Error handling: Empty state when no milestones defined.
 */
'use client';

import { useState } from 'react';
import { Target, Flag, AlertTriangle, CheckCircle2, Circle, ChevronDown, ChevronRight, Crosshair, Shield, Zap } from 'lucide-react';

interface Milestone {
  id: string;
  title: string;
  phase: string;
  status: 'complete' | 'active' | 'upcoming' | 'blocked';
  target: string;
  description: string;
  blockers?: string[];
  deliverables: string[];
}

const STATUS_STYLE = {
  complete: { color: '#3fb950', icon: <CheckCircle2 size={16} />, bg: '#3fb95010' },
  active: { color: '#58a6ff', icon: <Zap size={16} />, bg: '#58a6ff10' },
  upcoming: { color: '#8b949e', icon: <Circle size={16} />, bg: '#8b949e08' },
  blocked: { color: '#f85149', icon: <AlertTriangle size={16} />, bg: '#f8514910' },
};

const ROADMAP: Milestone[] = [
  {
    id: 'm1',
    title: 'Revenue Proof — $100 Pattern',
    phase: 'Phase 1: Validation',
    status: 'active',
    target: 'Feb 2026',
    description: 'Prove the $100 revenue pattern through 3D print sales and initial product traction.',
    deliverables: ['SKU-01 Dragon sales', 'Traction Clips batch', 'Payment gateway live'],
    blockers: ['Stripe live key rotation pending'],
  },
  {
    id: 'm2',
    title: 'Payment Gateway — Production',
    phase: 'Phase 1: Validation',
    status: 'complete',
    target: 'Feb 2026',
    description: 'Deploy payment gateway with Stripe integration, webhooks, and PaaS billing.',
    deliverables: ['Railway deployment', '43 tests passing', 'Webhook endpoint active', 'Swagger docs live'],
  },
  {
    id: 'm3',
    title: 'SiteGrade AI — Beta Launch',
    phase: 'Phase 2: Products',
    status: 'active',
    target: 'Mar 2026',
    description: 'Launch AI website auditor as a standalone product with Postman collection and API.',
    deliverables: ['Audit engine', 'Report generation', 'Postman collection', 'Dashboard UI'],
    blockers: ['Needs pricing model', 'Auth layer required'],
  },
  {
    id: 'm4',
    title: 'Agent Network — v1',
    phase: 'Phase 2: Products',
    status: 'upcoming',
    target: 'Q2 2026',
    description: 'Deploy agent roster with health monitoring, task assignment, and log aggregation.',
    deliverables: ['Agent health API', 'Task queue', 'Log viewer in Ursula'],
  },
  {
    id: 'm5',
    title: 'Ursula Hub — Public Deploy',
    phase: 'Phase 2: Products',
    status: 'active',
    target: 'Feb 2026',
    description: 'Deploy the ProtoForge command center to Vercel as the main operational dashboard.',
    deliverables: ['VS Code frame', 'Module system', 'Vercel deployment'],
  },
  {
    id: 'm6',
    title: 'ProtoForge Platform — Launch',
    phase: 'Phase 3: Scale',
    status: 'upcoming',
    target: 'Q3 2026',
    description: 'Full platform launch with multi-tenant support, billing, and public API.',
    deliverables: ['Multi-tenant auth', 'Public API', 'Documentation site', 'Billing integration'],
  },
];

export default function SituationRoomModule() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['m1', 'm3', 'm5']));

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const phases = [...new Set(ROADMAP.map(m => m.phase))];
  const completedCount = ROADMAP.filter(m => m.status === 'complete').length;
  const activeCount = ROADMAP.filter(m => m.status === 'active').length;
  const blockedCount = ROADMAP.filter(m => m.status === 'blocked').length;

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Crosshair size={20} style={{ color: '#f85149' }} />
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>Situation Room</h1>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            <Shield size={12} /> STRATEGIC OVERVIEW
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total', value: ROADMAP.length, color: 'var(--text-primary)' },
            { label: 'Complete', value: completedCount, color: '#3fb950' },
            { label: 'Active', value: activeCount, color: '#58a6ff' },
            { label: 'Blocked', value: blockedCount, color: '#f85149' },
          ].map(s => (
            <div key={s.label} className="rounded p-2 border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="px-6 py-4">
        {phases.map(phase => (
          <div key={phase} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Flag size={12} style={{ color: 'var(--text-accent)' }} />
              <span className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                {phase}
              </span>
            </div>

            <div className="space-y-2 ml-1 border-l-2 pl-4" style={{ borderColor: 'var(--border-color)' }}>
              {ROADMAP.filter(m => m.phase === phase).map(milestone => {
                const style = STATUS_STYLE[milestone.status];
                const isOpen = expanded.has(milestone.id);
                return (
                  <div
                    key={milestone.id}
                    className="rounded-md border transition-colors"
                    style={{ background: style.bg, borderColor: 'var(--border-color)' }}
                  >
                    {/* Milestone Header */}
                    <button
                      onClick={() => toggle(milestone.id)}
                      className="w-full flex items-center justify-between p-3 text-left"
                    >
                      <div className="flex items-center gap-3">
                        {/* Timeline dot */}
                        <span className="-ml-[29px] w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: style.color, background: milestone.status === 'complete' ? style.color : 'var(--bg-editor)' }} />
                        <span style={{ color: style.color }}>{style.icon}</span>
                        <div>
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>
                            {milestone.title}
                          </span>
                          <span className="text-[10px] font-mono ml-2" style={{ color: 'var(--text-secondary)' }}>
                            {milestone.target}
                          </span>
                        </div>
                      </div>
                      {isOpen ? <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />}
                    </button>

                    {/* Expanded Details */}
                    {isOpen && (
                      <div className="px-3 pb-3 ml-9">
                        <p className="text-[12px] mb-3 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          {milestone.description}
                        </p>
                        <div className="mb-2">
                          <span className="text-[10px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                            Deliverables
                          </span>
                          <ul className="mt-1 space-y-0.5">
                            {milestone.deliverables.map((d, i) => (
                              <li key={i} className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                                <CheckCircle2 size={10} style={{ color: milestone.status === 'complete' ? '#3fb950' : 'var(--border-color)' }} />
                                {d}
                              </li>
                            ))}
                          </ul>
                        </div>
                        {milestone.blockers && milestone.blockers.length > 0 && (
                          <div>
                            <span className="text-[10px] font-bold font-mono uppercase tracking-wider" style={{ color: '#f85149' }}>
                              Blockers
                            </span>
                            <ul className="mt-1 space-y-0.5">
                              {milestone.blockers.map((b, i) => (
                                <li key={i} className="flex items-center gap-2 text-[11px] font-mono" style={{ color: '#f85149' }}>
                                  <AlertTriangle size={10} />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
