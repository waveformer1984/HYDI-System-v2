'use client';

import React, { useEffect, useState } from 'react';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  estimatedHours: number;
  estimatedCost: number;
  status: string;
}

interface Schedule {
  id: string;
  name: string;
  interval: string;
  tasks: string[];
  nextDue: string;
}

interface Estimate {
  hours: number;
  cost: number;
  timeline: string;
  breakdown: Array<{ phase: string; hours: number; cost: number }>;
}

interface Property {
  id: string;
  name: string;
  type: string;
  sizeSqFt: number;
  yearBuilt: number;
  tasks: Task[];
  schedules: Schedule[];
  estimates: Estimate[];
}

export default function PorchwiseDashboard() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/porchwise/properties')
      .then(r => r.json())
      .then(data => {
        if (data.properties) setProperties(data.properties);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const priorityColor = (p: string) => {
    switch (p) {
      case 'high': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'medium': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'low': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'completed': return 'text-emerald-400';
      case 'in_progress': return 'text-blue-400';
      case 'pending': return 'text-neutral-500';
      default: return 'text-neutral-500';
    }
  };

  const prop = properties[0];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500">
          PORCHWISE // PROPERTY CARE
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Home and building maintenance intelligence</p>
      </header>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading property data...</div>
      ) : !prop ? (
        <div className="text-neutral-500 text-center py-20">No properties found.</div>
      ) : (
        <div className="space-y-8 max-w-5xl">
          {/* Property Header */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-neutral-100">{prop.name}</h2>
                <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">{prop.type} · {prop.sizeSqFt.toLocaleString()} sq ft · Built {prop.yearBuilt}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-amber-400">{prop.tasks.filter(t => t.status === 'pending').length}</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Pending Tasks</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Tasks */}
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Maintenance Tasks</h3>
              <div className="space-y-2">
                {prop.tasks.map(task => (
                  <div key={task.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-1">
                      <div className="text-sm font-semibold text-neutral-200">{task.title}</div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${priorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mb-2">{task.description}</p>
                    <div className="flex items-center gap-4 text-[10px] text-neutral-500">
                      <span className={statusColor(task.status)}>{task.status.replace('_', ' ')}</span>
                      <span>{task.estimatedHours}h est</span>
                      <span>${task.estimatedCost} est</span>
                      <span className="text-neutral-600">{task.category}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Schedules */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-neutral-200 mb-3">Recurring Schedules</h3>
                <div className="space-y-3">
                  {prop.schedules.map(sched => (
                    <div key={sched.id} className="border-b border-neutral-800 last:border-0 pb-3 last:pb-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-neutral-200">{sched.name}</span>
                        <span className="text-[10px] text-amber-400 uppercase tracking-wider">{sched.interval}</span>
                      </div>
                      <div className="text-xs text-neutral-500">{sched.tasks.join(' · ')}</div>
                      <div className="text-[10px] text-neutral-600 mt-1">Next due {new Date(sched.nextDue).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Estimate */}
              {prop.estimates[0] && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-neutral-200 mb-3">Project Estimate</h3>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-sm font-bold text-neutral-200">{prop.estimates[0].hours}h</div>
                      <div className="text-[9px] text-neutral-500 uppercase">Hours</div>
                    </div>
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-sm font-bold text-neutral-200">${prop.estimates[0].cost}</div>
                      <div className="text-[9px] text-neutral-500 uppercase">Cost</div>
                    </div>
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-sm font-bold text-neutral-200">{prop.estimates[0].timeline}</div>
                      <div className="text-[9px] text-neutral-500 uppercase">Timeline</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {prop.estimates[0].breakdown.map((b, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-neutral-400">{b.phase}</span>
                        <span className="text-neutral-500">{b.hours}h · ${b.cost}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
