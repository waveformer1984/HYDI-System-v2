/**
 * IdeaWorkshopModule — Brainstorm board for ProtoForge ideas
 * 
 * Kanban-style idea cards with tags, priority levels, and status tracking.
 * Ideas can be added, moved between columns, and tagged.
 * 
 * Config: Replace local state with Supabase persistence when ready.
 * Error handling: Graceful empty states per column.
 */
'use client';

import { useState } from 'react';
import { Lightbulb, Plus, Star, Tag, Flame, Clock, CheckCircle2, X, Sparkles } from 'lucide-react';

interface Idea {
  id: string;
  title: string;
  description: string;
  tags: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'spark' | 'developing' | 'ready' | 'shipped';
  createdAt: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#f85149',
  high: '#d29922',
  medium: '#58a6ff',
  low: '#858585',
};

const STATUS_CONFIG = {
  spark: { label: 'Spark', icon: <Sparkles size={12} />, color: '#d29922' },
  developing: { label: 'Developing', icon: <Clock size={12} />, color: '#58a6ff' },
  ready: { label: 'Ready', icon: <Star size={12} />, color: '#3fb950' },
  shipped: { label: 'Shipped', icon: <CheckCircle2 size={12} />, color: '#8b949e' },
};

const SEED_IDEAS: Idea[] = [
  {
    id: '1',
    title: 'SiteGrade AI — Public Launch',
    description: 'Package the AI auditor as a standalone SaaS product with Stripe billing.',
    tags: ['revenue', 'saas', 'launch'],
    priority: 'high',
    status: 'developing',
    createdAt: '2026-02-09',
  },
  {
    id: '2',
    title: 'Agent Marketplace',
    description: 'Let users browse, deploy, and configure ProtoForge agents from a catalog.',
    tags: ['agents', 'platform', 'ux'],
    priority: 'medium',
    status: 'spark',
    createdAt: '2026-02-09',
  },
  {
    id: '3',
    title: '3D Print Fulfillment Pipeline',
    description: 'Automated order → slice → print → ship workflow for ProtoForge products.',
    tags: ['manufacturing', 'automation', 'revenue'],
    priority: 'high',
    status: 'developing',
    createdAt: '2026-02-08',
  },
  {
    id: '4',
    title: 'Ursula Mobile View',
    description: 'Responsive layout for the hub so it works on phone/tablet.',
    tags: ['ux', 'mobile'],
    priority: 'low',
    status: 'spark',
    createdAt: '2026-02-09',
  },
  {
    id: '5',
    title: 'Payment Gateway — Live Keys',
    description: 'Rotate Stripe keys and go live with production billing.',
    tags: ['payments', 'security', 'launch'],
    priority: 'critical',
    status: 'ready',
    createdAt: '2026-02-07',
  },
];

export default function IdeaWorkshopModule() {
  const [ideas, setIdeas] = useState<Idea[]>(SEED_IDEAS);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const addIdea = () => {
    if (!newTitle.trim()) return;
    const idea: Idea = {
      id: Date.now().toString(),
      title: newTitle,
      description: newDesc,
      tags: [],
      priority: 'medium',
      status: 'spark',
      createdAt: new Date().toISOString().split('T')[0],
    };
    setIdeas(prev => [idea, ...prev]);
    setNewTitle('');
    setNewDesc('');
    setShowForm(false);
  };

  const columns: Array<{ status: Idea['status']; ideas: Idea[] }> = [
    { status: 'spark', ideas: ideas.filter(i => i.status === 'spark') },
    { status: 'developing', ideas: ideas.filter(i => i.status === 'developing') },
    { status: 'ready', ideas: ideas.filter(i => i.status === 'ready') },
    { status: 'shipped', ideas: ideas.filter(i => i.status === 'shipped') },
  ];

  const moveIdea = (id: string, newStatus: Idea['status']) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status: newStatus } : i));
  };

  const statuses: Idea['status'][] = ['spark', 'developing', 'ready', 'shipped'];

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <Lightbulb size={20} style={{ color: '#d29922' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>Idea Workshop</h1>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}>
            {ideas.length} ideas
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-mono transition-colors"
          style={{ background: '#d29922', color: '#000' }}
        >
          <Plus size={12} /> New Idea
        </button>
      </div>

      {/* New Idea Form */}
      {showForm && (
        <div className="px-6 py-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}>
          <div className="flex gap-3">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Idea title..."
              className="flex-1 px-3 py-2 rounded text-sm font-mono outline-none border"
              style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}
              onKeyDown={e => e.key === 'Enter' && addIdea()}
              autoFocus
            />
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description..."
              className="flex-1 px-3 py-2 rounded text-sm font-mono outline-none border"
              style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}
              onKeyDown={e => e.key === 'Enter' && addIdea()}
            />
            <button onClick={addIdea} className="px-4 py-2 rounded text-[12px] font-mono" style={{ background: '#3fb950', color: '#000' }}>
              Add
            </button>
            <button onClick={() => setShowForm(false)} className="px-2 py-2 rounded hover:bg-white/5">
              <X size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-6 h-full min-w-max">
          {columns.map(col => {
            const cfg = STATUS_CONFIG[col.status];
            return (
              <div key={col.status} className="flex flex-col w-72 shrink-0">
                {/* Column Header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span style={{ color: cfg.color }}>{cfg.icon}</span>
                  <span className="text-[12px] font-bold font-mono uppercase tracking-wider" style={{ color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}>
                    {col.ideas.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {col.ideas.map(idea => (
                    <div
                      key={idea.id}
                      className="rounded-md p-3 border transition-colors hover:border-[var(--text-accent)] group"
                      style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-active)' }}>
                          {idea.title}
                        </span>
                        <Flame size={10} style={{ color: PRIORITY_COLORS[idea.priority] }} />
                      </div>
                      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {idea.description}
                      </p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {idea.tags.map(tag => (
                          <span
                            key={tag}
                            className="flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--bg-editor)', color: 'var(--text-secondary)' }}
                          >
                            <Tag size={7} /> {tag}
                          </span>
                        ))}
                      </div>
                      {/* Move buttons */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {statuses.filter(s => s !== col.status).map(s => (
                          <button
                            key={s}
                            onClick={() => moveIdea(idea.id, s)}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
                            style={{ color: STATUS_CONFIG[s].color }}
                          >
                            → {STATUS_CONFIG[s].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {col.ideas.length === 0 && (
                    <div className="text-center py-8 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      No ideas here yet
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
