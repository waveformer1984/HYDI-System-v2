'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  targetDate?: string;
  budget?: number;
  spent?: number;
  taskCount: number;
  completedTasks: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
}

export default function ProtoIDashboard() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/protoi/projects').then(r => r.json()),
      fetch('/api/protoi/templates').then(r => r.json()),
    ]).then(([projData, tplData]) => {
      if (projData.projects) {
        const projects = projData.projects as Array<{
          id: string; title: string; description: string; category: string;
          status: string; priority: string; targetDate?: string; budget?: number;
          spent?: number; tasks?: Array<{ status: string }>;
        }>;
        setProjects(projects.map(p => ({
          id: p.id, title: p.title, description: p.description, category: p.category,
          status: p.status, priority: p.priority, targetDate: p.targetDate,
          budget: p.budget, spent: p.spent,
          taskCount: p.tasks?.length || 0,
          completedTasks: p.tasks?.filter(t => t.status === 'done').length || 0,
        })));
      }
      if (tplData.templates) setTemplates(tplData.templates);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case 'planning': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'paused': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'completed': return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const priorityDot = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-rose-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-neutral-500';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-teal-500">
          PROTOI // PROJECT WIZARD
        </h1>
        <p className="text-sm text-neutral-400 mt-1">DIY project management with AI-powered guidance</p>
      </header>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading project wizard...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Projects Panel */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-neutral-200">Active Projects</h2>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{projects.length} total</span>
            </div>

            <div className="space-y-3">
              {projects.map(p => {
                const progress = p.taskCount > 0 ? Math.round((p.completedTasks / p.taskCount) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/protoi/projects/${p.id}`}
                    className="block bg-neutral-900 border border-neutral-800 rounded-xl p-4 hover:border-cyan-500/30 transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${priorityDot(p.priority)}`} />
                        <span className="text-sm font-semibold text-neutral-200 group-hover:text-cyan-300 transition-colors">{p.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${statusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mb-3 line-clamp-2">{p.description}</p>
                    <div className="flex items-center gap-4 text-[10px] text-neutral-500">
                      <span>{p.completedTasks}/{p.taskCount} tasks</span>
                      {p.targetDate && <span>Due {new Date(p.targetDate).toLocaleDateString()}</span>}
                      {p.budget && <span>${p.spent || 0} / ${p.budget} spent</span>}
                    </div>
                    <div className="mt-2 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Templates Panel */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 h-fit">
            <h2 className="text-lg font-bold text-neutral-200 mb-4">Template Library</h2>
            <div className="space-y-3">
              {templates.map(tpl => (
                <div key={tpl.id} className="border border-neutral-800 rounded-lg p-3 hover:border-cyan-500/20 transition-colors cursor-pointer">
                  <div className="text-sm font-medium text-neutral-200">{tpl.name}</div>
                  <div className="text-xs text-neutral-500 mt-1">{tpl.description}</div>
                  <div className="text-[10px] text-cyan-500 uppercase tracking-wider mt-2">{tpl.category}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
