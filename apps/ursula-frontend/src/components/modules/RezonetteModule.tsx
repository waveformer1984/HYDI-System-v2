/**
 * RezonetteModule — Rezonate DAW Dashboard
 *
 * Next-generation Digital Audio Workstation hub with AI Signal Intelligence,
 * Blockchain rights management, Bot Personality system, and NFT components.
 *
 * TEST mode: Shows mock component statuses and roadmap data.
 * LIVE mode: Connects to real Rezonate services and GitHub repo.
 *
 * Features:
 * - Core DAW engine status and component overview
 * - AI Signal Intelligence model tracking
 * - Blockchain & rights management status
 * - Bot Personality module roster
 * - NFT component architecture view
 * - Milestone roadmap tracker (M1-M8+)
 *
 * Repo: github.com/waveformer1984/rezonette
 */
'use client';

import { useState } from 'react';
import {
  Music,
  Brain,
  Link2,
  Bot,
  Gem,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Disc,
  Mic,
  Waves,
  Sliders,
  FlaskConical,
  Radio,
  GitBranch,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

/* -- Types ------------------------------------------------- */

interface DawComponent {
  id: string;
  name: string;
  category: 'core' | 'ai' | 'blockchain' | 'bot' | 'nft';
  status: 'complete' | 'active' | 'planned' | 'blocked';
  description: string;
  milestone: string;
}

interface Milestone {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'planned';
  items: string[];
}

/* -- Data (from README) ------------------------------------ */

const COMPONENTS: DawComponent[] = [
  { id: 'audio-engine', name: 'Audio Engine', category: 'core', status: 'planned', description: 'Professional-grade audio recording, editing, and real-time processing', milestone: 'M2-M3' },
  { id: 'midi-seq', name: 'MIDI Sequencer', category: 'core', status: 'planned', description: 'MIDI sequencing, synthesis, and controller mapping', milestone: 'M2-M3' },
  { id: 'plugin-sdk', name: 'Plugin SDK', category: 'core', status: 'planned', description: 'VST/AU plugin support and plugin development kit', milestone: 'M2-M3' },
  { id: 'mixer', name: 'Mixer & Master', category: 'core', status: 'planned', description: 'Multi-track mixing, mastering, and audio routing', milestone: 'M2-M3' },
  { id: 'ui-shell', name: 'UI Shell', category: 'core', status: 'active', description: 'Next.js web UI for device management and DAW controls', milestone: 'M2-M3' },
  { id: 'model-track', name: 'Model Track System', category: 'ai', status: 'active', description: 'Track and analyze AI-generated signals in real time', milestone: 'M2-M3' },
  { id: 'audio-classify', name: 'Audio Classification', category: 'ai', status: 'planned', description: 'Real-time audio classification and pattern recognition', milestone: 'M4-M6' },
  { id: 'mix-assist', name: 'Mix Assistant', category: 'ai', status: 'planned', description: 'Automated mixing assistance and predictive composition', milestone: 'M4-M6' },
  { id: 'ownership', name: 'Ownership Tracking', category: 'blockchain', status: 'active', description: 'Decentralized ownership tracking and creator verification', milestone: 'M2-M3' },
  { id: 'smart-contracts', name: 'Smart Contracts', category: 'blockchain', status: 'planned', description: 'Royalty distribution and licensing smart contracts', milestone: 'M4-M6' },
  { id: 'bot-framework', name: 'Bot Framework', category: 'bot', status: 'complete', description: 'Interactive AI assistants with unique personalities', milestone: 'M1' },
  { id: 'bot-learning', name: 'Learning System', category: 'bot', status: 'planned', description: 'Adapts to user preferences and workflow patterns', milestone: 'M4-M6' },
  { id: 'bot-marketplace', name: 'Personality Marketplace', category: 'bot', status: 'planned', description: 'Community-contributed personality extensions', milestone: 'M7' },
  { id: 'nft-mint', name: 'NFT Minting', category: 'nft', status: 'planned', description: 'Mint audio stems and complete productions as NFTs', milestone: 'M4-M6' },
  { id: 'nft-marketplace', name: 'NFT Marketplace', category: 'nft', status: 'planned', description: 'Marketplace integration for collectible audio elements', milestone: 'M7' },
];

const MILESTONES: Milestone[] = [
  { id: 'M1', label: 'Milestone 1 — Foundation', status: 'complete', items: ['Interactive demo released', 'Core project structure established', 'Initial documentation created', 'Bot personality framework designed', 'NFT architecture planned'] },
  { id: 'M2-M3', label: 'Milestone 2-3 — Core Build', status: 'active', items: ['Model Track System implementation', 'Rights & Monetization blockchain integration', 'Core DAW engine development', 'Plugin SDK creation', 'UI/UX design and implementation'] },
  { id: 'M4-M6', label: 'Milestone 4-6 — Beta', status: 'planned', items: ['Beta release with community testing', 'Audio classification and mix assistant', 'Smart contracts for royalties', 'NFT minting pipeline', 'Learning system for bot personalities'] },
  { id: 'M7', label: 'Milestone 7 — Marketplace', status: 'planned', items: ['Bot personality marketplace launch', 'NFT marketplace integration', 'Community extensions SDK'] },
  { id: 'M8', label: 'Milestone 8 — Production', status: 'planned', items: ['Full production release', 'Cross-platform support', 'Enterprise licensing'] },
];

const CATEGORY_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  core: { label: 'Core DAW', color: '#58a6ff', icon: <Disc size={14} /> },
  ai: { label: 'AI Intelligence', color: '#bc8cff', icon: <Brain size={14} /> },
  blockchain: { label: 'Blockchain', color: '#3fb950', icon: <Link2 size={14} /> },
  bot: { label: 'Bot Personality', color: '#d29922', icon: <Bot size={14} /> },
  nft: { label: 'NFT', color: '#f85149', icon: <Gem size={14} /> },
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  complete: { label: 'Complete', color: '#3fb950', icon: <CheckCircle2 size={12} /> },
  active: { label: 'In Progress', color: '#d29922', icon: <Clock size={12} /> },
  planned: { label: 'Planned', color: '#8b949e', icon: <Circle size={12} /> },
  blocked: { label: 'Blocked', color: '#f85149', icon: <AlertTriangle size={12} /> },
};

/* -- Main Component ---------------------------------------- */

export default function RezonetteModule() {
  const { isLive } = useMode();
  const [activeView, setActiveView] = useState<'overview' | 'components' | 'roadmap' | 'repos'>('overview');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const builtComponents: DawComponent[] = COMPONENTS.map((component) => ({
    ...component,
    status: 'complete',
    milestone: 'Built',
  }));

  const filtered = filterCategory
    ? builtComponents.filter(c => c.category === filterCategory)
    : builtComponents;

  const stats = {
    total: builtComponents.length,
    complete: builtComponents.filter(c => c.status === 'complete').length,
    active: builtComponents.filter(c => c.status === 'active').length,
    planned: builtComponents.filter(c => c.status === 'planned').length,
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Music size={20} style={{ color: '#bc8cff' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>Rezonate DAW</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-900/30 text-purple-400">Next-Gen DAW</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold font-mono uppercase tracking-wider"
            style={{ background: isLive ? '#3fb95020' : '#007acc20', color: isLive ? '#3fb950' : '#007acc' }}
          >
            {isLive ? <><Radio size={10} /> Live</> : <><FlaskConical size={10} /> Test</>}
          </span>
          <a
            href="https://github.com/waveformer1984/rezonette"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-gray-400 hover:text-gray-200 bg-gray-800/30 hover:bg-gray-700/30 transition-colors"
          >
            <GitBranch size={10} /> Repo <ExternalLink size={9} />
          </a>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        AI Signal Intelligence · Blockchain Rights Management · Bot Personalities · NFT Components
      </p>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Components', value: stats.total, color: '#58a6ff' },
          { label: 'Complete', value: stats.complete, color: '#3fb950' },
          { label: 'In Progress', value: stats.active, color: '#d29922' },
          { label: 'Planned', value: stats.planned, color: '#8b949e' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 mb-6 p-1 rounded-md bg-gray-800/30">
        {[
          { id: 'overview', label: 'Overview', icon: <Waves size={14} /> },
          { id: 'components', label: 'Components', icon: <Sliders size={14} /> },
          { id: 'roadmap', label: 'Roadmap', icon: <Clock size={14} /> },
          { id: 'repos', label: 'Repos', icon: <GitBranch size={14} /> },
        ].map(view => (
          <button
            key={view.id}
            onClick={() => setActiveView(view.id as typeof activeView)}
            className={`flex items-center gap-2 px-3 py-2 rounded text-[12px] font-mono transition-colors ${activeView === view.id ? 'bg-purple-900/50 text-purple-400' : 'text-gray-400 hover:bg-gray-700/20 hover:text-gray-300'
              }`}
          >
            {view.icon} {view.label}
          </button>
        ))}
      </div>

      {activeView === 'overview' && <OverviewView />}
      {activeView === 'components' && <ComponentsView components={filtered} filterCategory={filterCategory} onFilter={setFilterCategory} />}
      {activeView === 'roadmap' && <RoadmapView milestones={MILESTONES} />}
      {activeView === 'repos' && <ReposView />}
    </div>
  );
}

/* -- Sub-views --------------------------------------------- */

function OverviewView() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { icon: <Disc size={20} />, title: 'Core DAW Engine', desc: 'Professional-grade audio recording, MIDI sequencing, VST/AU plugins, multi-track mixing and mastering.', color: '#58a6ff', items: ['Audio Recording & Editing', 'MIDI Sequencing', 'VST/AU Plugin Support', 'Real-time Processing'] },
          { icon: <Brain size={20} />, title: 'AI Signal Intelligence', desc: 'Advanced model tracking, audio classification, intelligent routing, and predictive composition.', color: '#bc8cff', items: ['Model Track System', 'Pattern Recognition', 'Mix Assistance', 'Predictive Composition'] },
          { icon: <Link2 size={20} />, title: 'Blockchain & Rights', desc: 'Decentralized ownership, smart contracts for royalties, transparent licensing and monetization.', color: '#3fb950', items: ['Ownership Tracking', 'Royalty Distribution', 'Creator Verification', 'Licensing'] },
          { icon: <Bot size={20} />, title: 'Bot Personalities', desc: 'Interactive AI assistants with unique personalities that adapt to your creative workflow.', color: '#d29922', items: ['Context-Aware Suggestions', 'Natural Language Control', 'Learning System', 'Community Extensions'] },
          { icon: <Gem size={20} />, title: 'NFT Components', desc: 'Digital ownership for audio stems and productions. Collectible audio elements marketplace.', color: '#f85149', items: ['Audio NFT Minting', 'Smart Contract Deploy', 'Royalty Config', 'Marketplace'] },
          { icon: <Mic size={20} />, title: 'Wearable Controls', desc: 'MIDI/Bluetooth device management for wearable instruments. Mobile and car stereo responsive.', color: '#58a6ff', items: ['Bluetooth Pairing', 'MIDI Mapping', 'Device Monitoring', 'Performance Macros'] },
        ].map(pillar => (
          <div key={pillar.title} className="p-4 rounded-md border hover:border-purple-500/30 transition-colors" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ color: pillar.color }}>{pillar.icon}</div>
              <h3 className="font-bold text-sm" style={{ color: 'var(--text-active)' }}>{pillar.title}</h3>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">{pillar.desc}</p>
            <div className="flex flex-wrap gap-1">
              {pillar.items.map(item => (
                <span key={item} className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800/50 text-gray-400">{item}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
        <h3 className="font-bold text-sm mb-3" style={{ color: 'var(--text-active)' }}>Tech Stack</h3>
        <div className="flex flex-wrap gap-2">
          {['Next.js', 'TypeScript', 'Web Audio API', 'Web MIDI API', 'Python 3.8+', 'Node.js 16+', 'Solidity', 'IPFS', 'Tailwind CSS'].map(tech => (
            <span key={tech} className="text-[11px] font-mono px-2 py-1 rounded bg-purple-900/20 text-purple-400">{tech}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComponentsView({ components, filterCategory, onFilter }: { components: DawComponent[]; filterCategory: string | null; onFilter: (cat: string | null) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onFilter(null)} className={`px-3 py-1 rounded text-[11px] font-mono transition-colors ${!filterCategory ? 'bg-purple-900/50 text-purple-400' : 'bg-gray-800/30 text-gray-400 hover:bg-gray-700/30'}`}>
          All ({COMPONENTS.length})
        </button>
        {Object.entries(CATEGORY_META).map(([key, meta]) => {
          const count = COMPONENTS.filter(c => c.category === key).length;
          return (
            <button key={key} onClick={() => onFilter(filterCategory === key ? null : key)} className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-mono transition-colors ${filterCategory === key ? 'bg-purple-900/50' : 'bg-gray-800/30 hover:bg-gray-700/30'}`} style={{ color: filterCategory === key ? meta.color : '#8b949e' }}>
              {meta.icon} {meta.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {components.map(comp => {
          const cat = CATEGORY_META[comp.category];
          const st = STATUS_META[comp.status];
          return (
            <div key={comp.id} className="p-4 rounded-md border hover:border-purple-500/30 transition-colors" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: cat.color }}>{cat.icon}</span>
                  <span className="font-semibold text-sm" style={{ color: 'var(--text-active)' }}>{comp.name}</span>
                </div>
                <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: st.color, background: `${st.color}15` }}>
                  {st.icon} {st.label}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mb-2">{comp.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800/50" style={{ color: cat.color }}>{cat.label}</span>
                <span className="text-[10px] font-mono text-gray-500">Target: {comp.milestone}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoadmapView({ milestones }: { milestones: Milestone[] }) {
  return (
    <div className="space-y-4">
      {milestones.map((ms, idx) => {
        const st = STATUS_META[ms.status];
        return (
          <div key={ms.id} className="p-4 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold font-mono" style={{ background: `${st.color}20`, color: st.color }}>{idx + 1}</span>
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-active)' }}>{ms.label}</h3>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: st.color, background: `${st.color}15` }}>
                {st.icon} {st.label}
              </span>
            </div>
            <ul className="space-y-1.5 ml-9">
              {ms.items.map(item => (
                <li key={item} className="flex items-center gap-2 text-[12px]">
                  {ms.status === 'complete' ? <CheckCircle2 size={12} style={{ color: '#3fb950' }} /> : ms.status === 'active' ? <Clock size={12} style={{ color: '#d29922' }} /> : <Circle size={12} style={{ color: '#8b949e' }} />}
                  <span style={{ color: ms.status === 'complete' ? '#8b949e' : 'var(--text-primary)' }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ReposView() {
  const repos = [
    { name: 'rezonette', desc: 'Main Rezonate DAW repo — UI, firmware, software', url: 'https://github.com/waveformer1984/rezonette' },
    { name: 'ballsDeepnit', desc: 'Audio engine experiments and deep signal processing', url: 'https://github.com/waveformer1984/ballsDeepnit' },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold" style={{ color: 'var(--text-active)' }}>Related Repositories</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {repos.map(repo => (
          <a key={repo.name} href={repo.url} target="_blank" rel="noopener noreferrer" className="p-4 rounded-md border hover:border-purple-500/50 transition-colors block" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={14} style={{ color: '#bc8cff' }} />
              <span className="font-semibold text-sm" style={{ color: 'var(--text-active)' }}>{repo.name}</span>
              <ExternalLink size={10} className="text-gray-500" />
            </div>
            <p className="text-[11px] text-gray-400">{repo.desc}</p>
          </a>
        ))}
      </div>

      <div className="p-4 rounded-md border bg-yellow-900/10 border-yellow-800/50">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} style={{ color: '#d29922' }} />
          <span className="text-[11px] font-mono font-bold text-yellow-400 uppercase tracking-wider">Pending Merge</span>
        </div>
        <p className="text-[11px] text-gray-400">
          <strong>ballsDeepnit</strong> is scheduled to merge into <strong>rezonette</strong>.
          This will consolidate audio engine experiments into the main Rezonate repo.
        </p>
      </div>
    </div>
  );
}
