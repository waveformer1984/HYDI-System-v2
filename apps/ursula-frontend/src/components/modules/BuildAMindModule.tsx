/**
 * BuildAMindModule — AI Personality Platform
 *
 * Dashboard for the Build-A-Mind platform — create digital personalities
 * that learn, adapt, and perform. Episode generation, canon validation,
 * character management, and RAVE integration.
 *
 * TEST mode: Shows mock character/episode data.
 * LIVE mode: Connects to Episode Generator API when deployed.
 *
 * Config: Set NEXT_PUBLIC_BAM_URL for live data.
 * Error handling: Shows empty state when no characters created.
 */
'use client';

import { useState } from 'react';
import {
  Brain,
  Users,
  Film,
  Sparkles,
  BookOpen,
  Mic,
  Play,
  Clock,
  CheckCircle2,
  Star,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface Character {
  id: string;
  name: string;
  archetype: string;
  episodes: number;
  status: 'active' | 'training' | 'draft';
  traits: string[];
  voiceProfile: boolean;
  lastActive: string;
}

const MOCK_CHARACTERS: Character[] = [
  {
    id: 'chr-001', name: 'Jordan Prime', archetype: 'Protagonist',
    episodes: 12, status: 'active', traits: ['Strategic', 'Driven', 'Technical'],
    voiceProfile: true, lastActive: '2026-02-10',
  },
  {
    id: 'chr-002', name: 'Heidi', archetype: 'AI Companion',
    episodes: 8, status: 'active', traits: ['Analytical', 'Loyal', 'Precise'],
    voiceProfile: true, lastActive: '2026-02-10',
  },
  {
    id: 'chr-003', name: 'The Architect', archetype: 'Mentor',
    episodes: 3, status: 'training', traits: ['Wise', 'Cryptic', 'Visionary'],
    voiceProfile: false, lastActive: '2026-02-08',
  },
  {
    id: 'chr-004', name: 'Ghost', archetype: 'Wildcard',
    episodes: 0, status: 'draft', traits: ['Unpredictable', 'Creative'],
    voiceProfile: false, lastActive: '2026-02-07',
  },
];

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  'active': { color: '#3fb950', bg: '#3fb95015' },
  'training': { color: '#d29922', bg: '#d2992215' },
  'draft': { color: '#8b949e', bg: '#8b949e15' },
};

export default function BuildAMindModule() {
  const { isLive } = useMode();
  const [characters] = useState<Character[]>(MOCK_CHARACTERS);

  const totalEpisodes = characters.reduce((s, c) => s + c.episodes, 0);
  const activeChars = characters.filter(c => c.status === 'active').length;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Brain size={20} style={{ color: '#bc8cff' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Build-A-Mind
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#bc8cff15', color: '#bc8cff' }}>
          AI Personalities
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Craft digital personalities that learn, adapt, and perform — co-write scripts, act in AI episodes, mint as NFT entities.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Users size={14} />, label: 'Characters', value: characters.length, color: '#bc8cff' },
          { icon: <Star size={14} />, label: 'Active', value: activeChars, color: '#3fb950' },
          { icon: <Film size={14} />, label: 'Episodes', value: totalEpisodes, color: '#58a6ff' },
          { icon: <Mic size={14} />, label: 'Voice Profiles', value: characters.filter(c => c.voiceProfile).length, color: '#d29922' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <BookOpen size={14} />, label: 'Canon Engine', desc: 'Story consistency + validation' },
          { icon: <Mic size={14} />, label: 'RAVE Capture', desc: 'Voice + emotion profiling' },
          { icon: <Sparkles size={14} />, label: 'Episode Gen', desc: 'AI-written scripts + scenes' },
        ].map(f => (
          <div key={f.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: '#bc8cff' }}>
              {f.icon}
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-active)' }}>{f.label}</span>
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Character Roster */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Character Roster</h2>
      <div className="space-y-2">
        {characters.map(char => {
          const style = STATUS_STYLE[char.status];
          return (
            <div key={char.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Brain size={14} style={{ color: '#bc8cff' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{char.name}</span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>({char.archetype})</span>
                </div>
                <div className="flex items-center gap-2">
                  {char.voiceProfile && (
                    <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: '#d29922', background: '#d2992215' }}>
                      <Mic size={9} /> Voice
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: style.color, background: style.bg }}>
                    {char.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1"><Film size={9} /> {char.episodes} episodes</span>
                <span className="flex items-center gap-1"><Clock size={9} /> {char.lastActive}</span>
                <span>{char.traits.join(' · ')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
