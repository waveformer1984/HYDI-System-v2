'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  completedAt?: string;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  status: string;
  dueDate: string;
}

interface Resource {
  id: string;
  name: string;
  type: string;
  allocated: number;
  used: number;
  unit?: string;
}

interface Log {
  id: string;
  type: string;
  content: string;
  createdAt: string;
}

interface ProjectDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  startDate?: string;
  targetDate?: string;
  budget?: number;
  spent?: number;
  milestones: Milestone[];
  tasks: Task[];
  resources: Resource[];
  logs: Log[];
}

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch('/api/protoi/projects')
      .then(r => r.json())
      .then(data => {
        const found = data.projects?.find((p: ProjectDetail) => p.id === id);
        if (found) setProject(found);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'planning': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'paused': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'completed': return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const taskStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'bg-emerald-500/20 text-emerald-400';
      case 'in_progress': return 'bg-blue-500/20 text-blue-400';
      case 'review': return 'bg-violet-500/20 text-violet-400';
      case 'todo': return 'bg-neutral-800 text-neutral-400';
      case 'backlog': return 'bg-neutral-900 text-neutral-500';
      default: return 'bg-neutral-800 text-neutral-400';
    }
  };

  const completedTasks = project?.tasks.filter(t => t.status === 'done').length || 0;
  const totalTasks = project?.tasks.length || 0;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <div className="mb-6">
        <Link href="/protoi" className="text-xs text-neutral-500 hover:text-cyan-400 transition-colors uppercase tracking-wider">
          ← Back to Project Wizard
        </Link>
      </div>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading project blueprint...</div>
      ) : !project ? (
        <div className="text-neutral-500 text-center py-20">Project not found.</div>
      ) : (
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Header */}
          <div className="border-b border-neutral-800 pb-6">
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${statusColor(project.status)}`}>
                {project.status}
              </span>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{project.category}</span>
            </div>
            <h1 className="text-2xl font-black text-neutral-100">{project.title}</h1>
            <p className="text-sm text-neutral-400 mt-2 leading-relaxed">{project.description}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-neutral-500">
              {project.startDate && <span>Started {new Date(project.startDate).toLocaleDateString()}</span>}
              {project.targetDate && <span>Target {new Date(project.targetDate).toLocaleDateString()}</span>}
              {project.budget && <span>Budget ${project.budget.toLocaleString()} · Spent ${(project.spent || 0).toLocaleString()}</span>}
            </div>
            <div className="mt-4 h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-teal-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-[10px] text-neutral-500 mt-1">{completedTasks}/{totalTasks} tasks · {progress}% complete</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Tasks */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Task Board</h2>
              <div className="space-y-2">
                {project.tasks.map(task => (
                  <div key={task.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-neutral-200">{task.title}</div>
                      <div className="text-xs text-neutral-500">{task.description}</div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${taskStatusColor(task.status)}`}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Logs */}
              <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider pt-4">Activity Log</h2>
              <div className="space-y-2">
                {project.logs.map(log => (
                  <div key={log.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded">{log.type}</span>
                      <span className="text-[10px] text-neutral-500">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-neutral-300">{log.content}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Milestones */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-neutral-200 mb-3">Milestones</h3>
                <div className="space-y-2">
                  {project.milestones.map(ms => (
                    <div key={ms.id} className="flex items-start gap-3">
                      <div className={`mt-1 w-2 h-2 rounded-full ${ms.status === 'achieved' ? 'bg-emerald-500' : 'bg-neutral-700'}`} />
                      <div>
                        <div className="text-sm text-neutral-200">{ms.title}</div>
                        <div className="text-xs text-neutral-500">{ms.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resources */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-neutral-200 mb-3">Resources</h3>
                <div className="space-y-3">
                  {project.resources.map(res => {
                    const pct = res.allocated > 0 ? Math.round((res.used / res.allocated) * 100) : 0;
                    return (
                      <div key={res.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-neutral-300">{res.name}</span>
                          <span className="text-neutral-500">{res.used} / {res.allocated} {res.unit || ''}</span>
                        </div>
                        <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
