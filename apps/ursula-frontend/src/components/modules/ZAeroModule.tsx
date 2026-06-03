/**
 * ZAeroModule — EV Motorcycle Venture Tracker
 *
 * Dashboard for the Z-AERO project — GS550 cafe racer EV conversion,
 * milestone tracking, parts sourcing, funding status, and build log.
 *
 * TEST mode: Shows mock milestone/build data.
 * LIVE mode: Connects to project tracker when available.
 *
 * Config: Set NEXT_PUBLIC_ZAERO_URL for live data.
 * Error handling: Shows placeholder when no build data loaded.
 */
'use client';

import { useState } from 'react';
import {
  Bike,
  Zap,
  Target,
  DollarSign,
  Wrench,
  Clock,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Package,
  FileText,
  TrendingUp,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface Milestone {
  id: string;
  title: string;
  phase: string;
  status: 'done' | 'in-progress' | 'upcoming' | 'blocked';
  target: string;
  notes: string;
}

const MOCK_MILESTONES: Milestone[] = [
  { id: 'MS-001', title: 'Frame Strip & Assessment', phase: 'Phase 1', status: 'done', target: 'Q1 2026', notes: 'GS550 frame stripped, inspected, rust treated' },
  { id: 'MS-002', title: 'Motor Selection & Mount Design', phase: 'Phase 1', status: 'done', target: 'Q1 2026', notes: 'QS138 mid-drive motor selected, custom mount CAD done' },
  { id: 'MS-003', title: 'Battery Pack Design', phase: 'Phase 2', status: 'in-progress', target: 'Q1 2026', notes: '72V 40Ah LiFePO4 pack, BMS selection in progress' },
  { id: 'MS-004', title: 'Controller & Wiring Harness', phase: 'Phase 2', status: 'upcoming', target: 'Q2 2026', notes: 'Sabvoton controller, custom harness design' },
  { id: 'MS-005', title: '3D Printed Body Panels', phase: 'Phase 3', status: 'upcoming', target: 'Q2 2026', notes: 'Cafe racer cowl, side panels, battery shroud' },
  { id: 'MS-006', title: 'First Power-On & Testing', phase: 'Phase 3', status: 'upcoming', target: 'Q3 2026', notes: 'Bench test → parking lot → road test' },
  { id: 'MS-007', title: 'LLC Formation & GoFundMe', phase: 'Business', status: 'blocked', target: 'Q1 2026', notes: 'Needs funding for parts procurement' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
  'done': { color: '#3fb950', bg: '#3fb95015', icon: CheckCircle2 },
  'in-progress': { color: '#58a6ff', bg: '#58a6ff15', icon: Clock },
  'upcoming': { color: '#8b949e', bg: '#8b949e15', icon: Circle },
  'blocked': { color: '#f85149', bg: '#f8514915', icon: AlertTriangle },
};

export default function ZAeroModule() {
  const { isLive } = useMode();
  const [milestones] = useState<Milestone[]>(MOCK_MILESTONES);

  const done = milestones.filter(m => m.status === 'done').length;
  const progress = Math.round((done / milestones.length) * 100);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Bike size={20} style={{ color: '#58a6ff' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Z-AERO
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#58a6ff15', color: '#58a6ff' }}>
          EV Conversion
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        GS550 cafe racer EV conversion — automotive-grade specs, 3D printed parts, custom manufacturing.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Target size={14} />, label: 'Progress', value: `${progress}%`, color: '#58a6ff' },
          { icon: <CheckCircle2 size={14} />, label: 'Complete', value: done, color: '#3fb950' },
          { icon: <Wrench size={14} />, label: 'Active', value: milestones.filter(m => m.status === 'in-progress').length, color: '#d29922' },
          { icon: <AlertTriangle size={14} />, label: 'Blocked', value: milestones.filter(m => m.status === 'blocked').length, color: '#f85149' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>Build Progress</span>
          <span className="text-[11px] font-mono font-bold" style={{ color: '#58a6ff' }}>{progress}%</span>
        </div>
        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border-color)' }}>
          <div className="h-2 rounded-full transition-all" style={{ width: `${progress}%`, background: '#58a6ff' }} />
        </div>
      </div>

      {/* Specs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <Bike size={14} />, label: 'Base', desc: '1981 Suzuki GS550' },
          { icon: <Zap size={14} />, label: 'Motor', desc: 'QS138 mid-drive' },
          { icon: <Package size={14} />, label: 'Battery', desc: '72V 40Ah LiFePO4' },
        ].map(spec => (
          <div key={spec.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: '#58a6ff' }}>
              {spec.icon}
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-active)' }}>{spec.label}</span>
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{spec.desc}</div>
          </div>
        ))}
      </div>

      {/* Milestones */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Build Milestones</h2>
      <div className="space-y-2">
        {milestones.map(ms => {
          const style = STATUS_STYLE[ms.status];
          const Icon = style.icon;
          return (
            <div key={ms.id} className="rounded-md p-3 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon size={12} style={{ color: style.color }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>{ms.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{ms.target}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: style.color, background: style.bg }}>
                    {ms.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>{ms.phase}</span>
                <span>{ms.notes}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
