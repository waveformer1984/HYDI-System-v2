/**
 * ConceptMatrixModule — Grid of ProtoForge concepts with status and connections
 * 
 * Visual matrix showing all product/service concepts, their maturity level,
 * dependencies, and interconnections.
 * 
 * Config: Replace CONCEPTS array with API data when available.
 * Error handling: Empty state when no concepts defined.
 */
'use client';

import { useState } from 'react';
import { Grid3X3, ArrowRight, Circle, Layers, Link2, Filter } from 'lucide-react';

interface Concept {
  id: string;
  name: string;
  category: 'product' | 'service' | 'infrastructure' | 'agent';
  maturity: 'idea' | 'prototype' | 'beta' | 'production';
  description: string;
  connects: string[];  // IDs of related concepts
  owner: string;
  revenue: boolean;
}

const MATURITY_STYLE = {
  idea: { color: '#8b949e', label: 'Idea', width: '15%' },
  prototype: { color: '#d29922', label: 'Prototype', width: '40%' },
  beta: { color: '#58a6ff', label: 'Beta', width: '70%' },
  production: { color: '#3fb950', label: 'Production', width: '100%' },
};

const CATEGORY_COLORS: Record<string, string> = {
  product: '#58a6ff',
  service: '#d29922',
  infrastructure: '#3fb950',
  agent: '#bc8cff',
};

const CONCEPTS: Concept[] = [
  {
    id: 'sitegrade',
    name: 'SiteGrade AI',
    category: 'product',
    maturity: 'beta',
    description: 'AI-powered website auditor with scoring and recommendations',
    connects: ['gateway', 'ursula'],
    owner: 'Jordan',
    revenue: true,
  },
  {
    id: 'gateway',
    name: 'Payment Gateway',
    category: 'infrastructure',
    maturity: 'production',
    description: 'Stripe-integrated payment processing with PaaS billing',
    connects: ['hydipay', 'sitegrade'],
    owner: 'System',
    revenue: true,
  },
  {
    id: 'hydipay',
    name: 'HydiPay',
    category: 'service',
    maturity: 'prototype',
    description: 'Payment orchestration layer for ProtoForge products',
    connects: ['gateway'],
    owner: 'Jordan',
    revenue: true,
  },
  {
    id: 'ursula',
    name: 'Ursula Hub',
    category: 'infrastructure',
    maturity: 'prototype',
    description: 'VS Code-style command center for all ProtoForge operations',
    connects: ['sitegrade', 'agents', 'gateway'],
    owner: 'Jordan',
    revenue: false,
  },
  {
    id: 'agents',
    name: 'Agent Network',
    category: 'agent',
    maturity: 'idea',
    description: 'Autonomous agent roster — DevOps, Funding, Ghostwriter, Fabricator',
    connects: ['ursula'],
    owner: 'System',
    revenue: false,
  },
  {
    id: '3dprint',
    name: '3D Print Pipeline',
    category: 'product',
    maturity: 'prototype',
    description: 'Automated order-to-ship workflow for physical products',
    connects: ['gateway', 'hydipay'],
    owner: 'Jordan',
    revenue: true,
  },
  {
    id: 'forgefinder',
    name: 'ForgeFinder',
    category: 'product',
    maturity: 'idea',
    description: 'Historical artifact discovery and valuation engine',
    connects: ['agents'],
    owner: 'Jordan',
    revenue: true,
  },
  {
    id: 'ghostwriter',
    name: 'Ghostwriter Agent',
    category: 'agent',
    maturity: 'idea',
    description: 'AI content generation for marketing, docs, and copy',
    connects: ['agents'],
    owner: 'System',
    revenue: true,
  },
];

export default function ConceptMatrixModule() {
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = filter ? CONCEPTS.filter(c => c.category === filter) : CONCEPTS;
  const selectedConcept = selected ? CONCEPTS.find(c => c.id === selected) : null;
  const categories = [...new Set(CONCEPTS.map(c => c.category))];

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-editor)' }}>
      {/* Main Grid */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Grid3X3 size={20} style={{ color: '#bc8cff' }} />
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>Concept Matrix</h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}>
                {CONCEPTS.length} concepts
              </span>
            </div>
          </div>

          {/* Category Filters */}
          <div className="flex items-center gap-2">
            <Filter size={12} style={{ color: 'var(--text-secondary)' }} />
            <button
              onClick={() => setFilter(null)}
              className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
              style={{
                background: filter === null ? 'var(--text-accent)' : 'var(--bg-sidebar)',
                color: filter === null ? '#fff' : 'var(--text-secondary)',
              }}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(filter === cat ? null : cat)}
                className="text-[10px] font-mono px-2 py-1 rounded capitalize transition-colors"
                style={{
                  background: filter === cat ? CATEGORY_COLORS[cat] + '30' : 'var(--bg-sidebar)',
                  color: filter === cat ? CATEGORY_COLORS[cat] : 'var(--text-secondary)',
                  border: filter === cat ? `1px solid ${CATEGORY_COLORS[cat]}40` : '1px solid transparent',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-6">
          {filtered.map(concept => {
            const mat = MATURITY_STYLE[concept.maturity];
            const isSelected = selected === concept.id;
            const isConnected = selectedConcept?.connects.includes(concept.id);
            return (
              <div
                key={concept.id}
                onClick={() => setSelected(isSelected ? null : concept.id)}
                className="rounded-md p-4 border cursor-pointer transition-all"
                style={{
                  background: 'var(--bg-sidebar)',
                  borderColor: isSelected ? 'var(--text-accent)' : isConnected ? '#58a6ff40' : 'var(--border-color)',
                  boxShadow: isConnected ? '0 0 12px #58a6ff15' : 'none',
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Circle size={8} fill={CATEGORY_COLORS[concept.category]} stroke={CATEGORY_COLORS[concept.category]} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{concept.name}</span>
                  </div>
                  {concept.revenue && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
                      $
                    </span>
                  )}
                </div>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-secondary)' }}>{concept.description}</p>

                {/* Maturity Bar */}
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-mono uppercase" style={{ color: mat.color }}>{mat.label}</span>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>{concept.owner}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--bg-editor)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: mat.width, background: mat.color }} />
                  </div>
                </div>

                {/* Connections */}
                {concept.connects.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Link2 size={9} style={{ color: 'var(--text-secondary)' }} />
                    {concept.connects.map(cid => {
                      const target = CONCEPTS.find(c => c.id === cid);
                      return target ? (
                        <span key={cid} className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: 'var(--bg-editor)', color: 'var(--text-secondary)' }}>
                          {target.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedConcept && (
        <div className="w-72 border-l overflow-y-auto p-4 shrink-0" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} style={{ color: 'var(--text-accent)' }} />
            <span className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
              Detail
            </span>
          </div>
          <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-active)' }}>{selectedConcept.name}</h3>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-secondary)' }}>{selectedConcept.description}</p>

          <div className="space-y-3 text-[11px] font-mono">
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Category: </span>
              <span className="capitalize" style={{ color: CATEGORY_COLORS[selectedConcept.category] }}>{selectedConcept.category}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Maturity: </span>
              <span style={{ color: MATURITY_STYLE[selectedConcept.maturity].color }}>{MATURITY_STYLE[selectedConcept.maturity].label}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Owner: </span>
              <span style={{ color: 'var(--text-primary)' }}>{selectedConcept.owner}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Revenue: </span>
              <span style={{ color: selectedConcept.revenue ? '#3fb950' : 'var(--text-secondary)' }}>{selectedConcept.revenue ? 'Yes' : 'No'}</span>
            </div>
            {selectedConcept.connects.length > 0 && (
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Connects to:</span>
                <div className="mt-1 space-y-1">
                  {selectedConcept.connects.map(cid => {
                    const t = CONCEPTS.find(c => c.id === cid);
                    return t ? (
                      <div key={cid} className="flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                        <ArrowRight size={10} style={{ color: 'var(--text-accent)' }} />
                        {t.name}
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
