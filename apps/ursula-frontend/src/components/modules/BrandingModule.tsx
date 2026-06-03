/**
 * BrandingModule — ProtoForge brand identity, assets, colors, typography
 * 
 * Full brand identity panel with editable description, personality traits,
 * mission, audience, color palette, typography scale, and logo.
 * 
 * TEST mode: Shows mock brand identity data.
 * LIVE mode: Editable fields that persist to localStorage.
 * 
 * Config: Brand identity fields save to localStorage key 'ursula-brand-identity'.
 * Error handling: Falls back to mock data if localStorage unavailable.
 */
'use client';

import { Palette, Type, Copy, Check, Sparkles, Fingerprint, Save, Pencil, Users, Target, MessageSquare, FlaskConical, Radio } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useMode } from '@/lib/mode-context';

interface BrandIdentity {
  description: string;
  mission: string;
  personality: string[];
  audience: string;
  tagline: string;
  founded: string;
  founder: string;
  location: string;
}

const MOCK_IDENTITY: BrandIdentity = {
  description: 'ProtoForge is a builder-first technology studio that designs, ships, and monetizes digital products. We build AI agents, SaaS tools, payment infrastructure, and creative automation — all governed by a grounded truth protocol that prioritizes verification over optimism.',
  mission: 'Build real things. Prove patterns. Ship revenue-generating products that solve actual problems — not vaporware.',
  personality: ['Builder', 'Direct', 'Technical', 'Resourceful', 'Relentless'],
  audience: 'Solo founders, indie hackers, small dev teams, and technical creators who need production-grade tools without enterprise overhead.',
  tagline: 'Build. Prove. Ship.',
  founded: '2025',
  founder: 'Jordan Arenstein',
  location: 'Remote-first',
};

const STORAGE_KEY = 'ursula-brand-identity';

interface ColorToken {
  name: string;
  hex: string;
  usage: string;
}

const BRAND_COLORS: ColorToken[] = [
  { name: 'Forge Blue', hex: '#007acc', usage: 'Primary accent, links, active states' },
  { name: 'Forge Dark', hex: '#1e1e1e', usage: 'Backgrounds, editor areas' },
  { name: 'Sidebar', hex: '#252526', usage: 'Secondary backgrounds, panels' },
  { name: 'Success', hex: '#3fb950', usage: 'Online status, completions, revenue' },
  { name: 'Warning', hex: '#d29922', usage: 'Caution states, pending items' },
  { name: 'Danger', hex: '#f85149', usage: 'Errors, blockers, critical alerts' },
  { name: 'Purple', hex: '#bc8cff', usage: 'Agent identity, concepts, special' },
  { name: 'Text Primary', hex: '#cccccc', usage: 'Body text, descriptions' },
  { name: 'Text Active', hex: '#ffffff', usage: 'Headings, active labels' },
  { name: 'Text Muted', hex: '#858585', usage: 'Secondary text, timestamps' },
  { name: 'Border', hex: '#3c3c3c', usage: 'Dividers, card borders' },
  { name: 'Status Bar', hex: '#007acc', usage: 'Bottom status strip' },
];

const TYPOGRAPHY = [
  { name: 'Display', size: '24px', weight: '700', sample: 'ProtoForge Command Center' },
  { name: 'Heading', size: '18px', weight: '700', sample: 'Module Title' },
  { name: 'Subheading', size: '14px', weight: '600', sample: 'Section Header' },
  { name: 'Body', size: '13px', weight: '400', sample: 'Standard body text for descriptions and content.' },
  { name: 'Caption', size: '11px', weight: '400', sample: 'Timestamps, labels, metadata' },
  { name: 'Mono', size: '12px', weight: '400', sample: 'font-mono: code, data, terminal output' },
  { name: 'Micro', size: '9px', weight: '700', sample: 'TAGS, BADGES, STATUS LABELS' },
];

const BRAND_VALUES = [
  { title: 'Truth First', desc: 'No false completion signals. Verified or not.' },
  { title: 'Builder Ethos', desc: 'Ship real things. Prove patterns. Revenue validates.' },
  { title: 'Stability > Cleverness', desc: 'Simple + verifiable over fancy + fragile.' },
  { title: 'Net Positive', desc: 'Every action creates value for Jordan and ProtoForge.' },
];

export default function BrandingModule() {
  const { isLive, isTest } = useMode();
  const [copied, setCopied] = useState<string | null>(null);
  const [identity, setIdentity] = useState<BrandIdentity>(MOCK_IDENTITY);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BrandIdentity>(MOCK_IDENTITY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isLive) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as BrandIdentity;
          setIdentity(parsed);
          setDraft(parsed);
        }
      } catch {
        // fall back to mock
      }
    } else {
      setIdentity(MOCK_IDENTITY);
      setDraft(MOCK_IDENTITY);
      setEditing(false);
    }
  }, [isLive]);

  const saveIdentity = useCallback(() => {
    setIdentity(draft);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // silent
    }
  }, [draft]);

  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopied(hex);
    setTimeout(() => setCopied(null), 1500);
  };

  const charCount = draft.description.length;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Palette size={20} style={{ color: '#bc8cff' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>ProtoForge Brand</h1>
        </div>
        <span
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold font-mono uppercase tracking-wider"
          style={{
            background: isLive ? '#3fb95020' : '#007acc20',
            color: isLive ? '#3fb950' : '#007acc',
          }}
        >
          {isLive ? <><Radio size={10} /> Live</> : <><FlaskConical size={10} /> Test</>}
        </span>
      </div>

      {/* ═══ BRAND IDENTITY ═══ */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Fingerprint size={14} style={{ color: '#bc8cff' }} />
            <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: '#bc8cff' }}>
              Brand Identity
            </h2>
          </div>
          {isLive && !editing && (
            <button
              onClick={() => { setDraft(identity); setEditing(true); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-accent)' }}
            >
              <Pencil size={10} /> Edit
            </button>
          )}
          {isLive && editing && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setEditing(false); setDraft(identity); }}
                className="px-2 py-1 rounded text-[10px] font-mono transition-colors hover:bg-white/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={saveIdentity}
                className="flex items-center gap-1 px-3 py-1 rounded text-[10px] font-mono font-bold transition-colors"
                style={{ background: '#3fb95030', color: '#3fb950' }}
              >
                <Save size={10} /> Save
              </button>
            </div>
          )}
          {saved && (
            <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: '#3fb950' }}>
              <Check size={10} /> Saved
            </span>
          )}
        </div>

        <div
          className="rounded-md border p-5 space-y-5"
          style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
        >
          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                Description
              </label>
              {editing && (
                <span className="text-[9px] font-mono" style={{ color: charCount > 400 ? '#f85149' : 'var(--text-secondary)' }}>
                  {charCount}/400
                </span>
              )}
            </div>
            {editing ? (
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                maxLength={400}
                rows={4}
                className="w-full rounded-md p-3 text-[12px] leading-relaxed resize-none outline-none border focus:border-[var(--text-accent)] transition-colors"
                style={{
                  background: 'var(--bg-editor)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
                placeholder="Describe your site or business..."
              />
            ) : (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {identity.description}
              </p>
            )}
          </div>

          {/* Mission */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Target size={10} style={{ color: 'var(--text-accent)' }} />
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                Mission
              </label>
            </div>
            {editing ? (
              <textarea
                value={draft.mission}
                onChange={(e) => setDraft({ ...draft, mission: e.target.value })}
                rows={2}
                className="w-full rounded-md p-3 text-[12px] leading-relaxed resize-none outline-none border focus:border-[var(--text-accent)] transition-colors"
                style={{
                  background: 'var(--bg-editor)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            ) : (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {identity.mission}
              </p>
            )}
          </div>

          {/* Personality Traits */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <MessageSquare size={10} style={{ color: 'var(--text-accent)' }} />
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                Personality
              </label>
            </div>
            {editing ? (
              <input
                type="text"
                value={draft.personality.join(', ')}
                onChange={(e) => setDraft({ ...draft, personality: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                className="w-full rounded-md p-3 text-[12px] outline-none border focus:border-[var(--text-accent)] transition-colors"
                style={{
                  background: 'var(--bg-editor)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
                placeholder="Comma-separated traits: Bold, Technical, Direct..."
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {identity.personality.map(trait => (
                  <span
                    key={trait}
                    className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider"
                    style={{ background: '#bc8cff20', color: '#bc8cff' }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Audience */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users size={10} style={{ color: 'var(--text-accent)' }} />
              <label className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                Target Audience
              </label>
            </div>
            {editing ? (
              <textarea
                value={draft.audience}
                onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
                rows={2}
                className="w-full rounded-md p-3 text-[12px] leading-relaxed resize-none outline-none border focus:border-[var(--text-accent)] transition-colors"
                style={{
                  background: 'var(--bg-editor)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            ) : (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {identity.audience}
              </p>
            )}
          </div>

          {/* Quick Facts Row */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            {editing ? (
              <>
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider block mb-1" style={{ color: 'var(--text-secondary)' }}>Tagline</label>
                  <input
                    type="text"
                    value={draft.tagline}
                    onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
                    className="w-full rounded p-2 text-[11px] outline-none border focus:border-[var(--text-accent)] transition-colors"
                    style={{ background: 'var(--bg-editor)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider block mb-1" style={{ color: 'var(--text-secondary)' }}>Founder</label>
                  <input
                    type="text"
                    value={draft.founder}
                    onChange={(e) => setDraft({ ...draft, founder: e.target.value })}
                    className="w-full rounded p-2 text-[11px] outline-none border focus:border-[var(--text-accent)] transition-colors"
                    style={{ background: 'var(--bg-editor)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider block mb-1" style={{ color: 'var(--text-secondary)' }}>Founded</label>
                  <input
                    type="text"
                    value={draft.founded}
                    onChange={(e) => setDraft({ ...draft, founded: e.target.value })}
                    className="w-full rounded p-2 text-[11px] outline-none border focus:border-[var(--text-accent)] transition-colors"
                    style={{ background: 'var(--bg-editor)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Tagline</div>
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-active)' }}>{identity.tagline}</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Founder</div>
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-active)' }}>{identity.founder}</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Founded</div>
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-active)' }}>{identity.founded}</div>
                </div>
              </>
            )}
          </div>

          {isTest && (
            <p className="text-[9px] font-mono pt-2" style={{ color: 'var(--text-secondary)' }}>
              Switch to LIVE mode to edit brand identity fields. Changes persist to localStorage.
            </p>
          )}
        </div>
      </section>

      {/* Brand Values */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={14} style={{ color: 'var(--text-accent)' }} />
          <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
            Brand Values
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {BRAND_VALUES.map(v => (
            <div key={v.title} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-active)' }}>{v.title}</div>
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{v.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Color Palette */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Palette size={14} style={{ color: 'var(--text-accent)' }} />
          <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
            Color Palette
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {BRAND_COLORS.map(color => (
            <div
              key={color.name}
              className="rounded-md border overflow-hidden cursor-pointer group transition-colors hover:border-[var(--text-accent)]"
              style={{ borderColor: 'var(--border-color)' }}
              onClick={() => copyHex(color.hex)}
            >
              <div className="h-16" style={{ background: color.hex }} />
              <div className="p-3" style={{ background: 'var(--bg-sidebar)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-active)' }}>{color.name}</span>
                  {copied === color.hex ? (
                    <Check size={12} style={{ color: '#3fb950' }} />
                  ) : (
                    <Copy size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }} />
                  )}
                </div>
                <div className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>{color.hex}</div>
                <div className="text-[9px]" style={{ color: 'var(--text-secondary)' }}>{color.usage}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography Scale */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Type size={14} style={{ color: 'var(--text-accent)' }} />
          <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
            Typography Scale
          </h2>
        </div>
        <div className="space-y-2">
          {TYPOGRAPHY.map(t => (
            <div
              key={t.name}
              className="flex items-center gap-4 p-3 rounded-md border"
              style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
            >
              <div className="w-24 shrink-0">
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-accent)' }}>{t.name}</div>
                <div className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>{t.size} / {t.weight}</div>
              </div>
              <div
                className={t.name === 'Mono' ? 'font-mono' : ''}
                style={{
                  fontSize: t.size,
                  fontWeight: t.weight,
                  color: 'var(--text-active)',
                  letterSpacing: t.name === 'Micro' ? '0.15em' : undefined,
                  textTransform: t.name === 'Micro' ? 'uppercase' : undefined,
                }}
              >
                {t.sample}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Logo & Identity */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
            Logo & Identity
          </h2>
        </div>
        <div
          className="rounded-md p-8 border text-center"
          style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-3xl font-bold mb-2 tracking-tight" style={{ color: 'var(--text-active)' }}>
            Proto<span style={{ color: 'var(--text-accent)' }}>Forge</span>
          </div>
          <div className="text-[11px] font-mono mb-4" style={{ color: 'var(--text-secondary)' }}>
            {identity.tagline}
          </div>
          <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            Add logo assets to /public/brand/ and reference them here.
          </p>
        </div>
      </section>
    </div>
  );
}
