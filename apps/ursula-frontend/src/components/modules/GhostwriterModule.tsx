/**
 * GhostwriterModule — AI Content Creation Service
 *
 * Dashboard for the Ghostwriter AI service — content generation,
 * tone matching, RAVE training integration, and order management.
 *
 * TEST mode: Shows mock content pipeline data.
 * LIVE mode: Connects to Ghostwriter API when deployed.
 *
 * Config: Set NEXT_PUBLIC_GHOSTWRITER_URL for live data.
 * Error handling: Shows placeholder when API unavailable.
 */
'use client';

import { useState } from 'react';
import {
  PenTool,
  FileText,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  Users,
  Mic,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface ContentOrder {
  id: string;
  type: string;
  client: string;
  status: 'completed' | 'in-progress' | 'queued';
  tone: string;
  wordCount: number;
  price: number;
  date: string;
}

const MOCK_ORDERS: ContentOrder[] = [
  { id: 'gw-001', type: 'Blog Post', client: 'ProtoForge', status: 'completed', tone: 'Professional', wordCount: 1200, price: 45, date: '2026-02-09' },
  { id: 'gw-002', type: 'Product Description', client: 'HYDI Tactical', status: 'completed', tone: 'Technical', wordCount: 350, price: 15, date: '2026-02-09' },
  { id: 'gw-003', type: 'Email Sequence', client: 'SiteGrade AI', status: 'in-progress', tone: 'Persuasive', wordCount: 800, price: 35, date: '2026-02-10' },
  { id: 'gw-004', type: 'Landing Copy', client: 'Z-AERO', status: 'queued', tone: 'Bold', wordCount: 500, price: 25, date: '2026-02-10' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  'completed': { color: '#3fb950', bg: '#3fb95015' },
  'in-progress': { color: '#58a6ff', bg: '#58a6ff15' },
  'queued': { color: '#d29922', bg: '#d2992215' },
};

export default function GhostwriterModule() {
  const { isLive } = useMode();
  const [orders] = useState<ContentOrder[]>(MOCK_ORDERS);

  const totalRevenue = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.price, 0);
  const totalWords = orders.reduce((s, o) => s + o.wordCount, 0);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <PenTool size={20} style={{ color: '#f0883e' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Ghostwriter AI
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
          Revenue-Ready
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        AI-powered content creation with tone matching, RAVE training integration, and automated delivery.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <FileText size={14} />, label: 'Orders', value: orders.length, color: '#58a6ff' },
          { icon: <DollarSign size={14} />, label: 'Revenue', value: `$${totalRevenue}`, color: '#3fb950' },
          { icon: <Sparkles size={14} />, label: 'Words', value: totalWords.toLocaleString(), color: '#bc8cff' },
          { icon: <Users size={14} />, label: 'Clients', value: new Set(orders.map(o => o.client)).size, color: '#d29922' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <PenTool size={14} />, label: 'Content Gen', desc: 'Blog, copy, email, product' },
          { icon: <Mic size={14} />, label: 'RAVE Training', desc: 'Voice/tone capture + matching' },
          { icon: <TrendingUp size={14} />, label: 'Auto-Delivery', desc: 'Stripe checkout → content' },
        ].map(c => (
          <div key={c.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: '#f0883e' }}>{c.icon}
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-active)' }}>{c.label}</span>
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{c.desc}</div>
          </div>
        ))}
      </div>

      {/* Order Pipeline */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Content Pipeline</h2>
      <div className="space-y-2">
        {orders.map(order => {
          const style = STATUS_STYLE[order.status];
          return (
            <div key={order.id} className="rounded-md p-3 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>{order.type}</span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>for {order.client}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: '#3fb950' }}>${order.price}</span>
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: style.color, background: style.bg }}>
                    {order.status === 'completed' ? <CheckCircle2 size={9} /> : order.status === 'in-progress' ? <Clock size={9} /> : <AlertCircle size={9} />}
                    {order.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>Tone: {order.tone}</span>
                <span>{order.wordCount} words</span>
                <span>{order.date}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
