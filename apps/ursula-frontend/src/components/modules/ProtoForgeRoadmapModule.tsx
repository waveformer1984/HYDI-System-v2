'use client';

import { useMemo, useState } from 'react';
import {
  Briefcase,
  DollarSign,
  Code,
  Users,
  Zap,
  Target,
  TrendingUp,
  Building,
  Globe,
  Rocket,
  Brain,
  Cpu,
  Network,
  PieChart,
  CreditCard,
  ShoppingBag,
  FileText,
  Lightbulb,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Filter,
  Layers,
  Play
} from 'lucide-react';
import { projectOps } from '@/lib/projectOpsClient';

interface RoadmapNode {
  id: string;
  title: string;
  description: string;
  chapter: 'Foundation' | 'Agents' | 'Revenue' | 'Distribution';
  category: 'revenue' | 'technology' | 'service' | 'infrastructure';
  status: 'completed' | 'in-progress' | 'planned' | 'vision';
  revenue?: string;
  ttc?: '7d' | '30d' | '90d+'; // time-to-cash
  connections: string[];
  icon: React.ReactNode;
}

const ProtoForgeRoadmapModule: React.FC = () => {
  const [selectedNode, setSelectedNode] = useState<RoadmapNode | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoadmapNode['status'] | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<RoadmapNode['category'] | 'all'>('all');
  const [isRevenueLens, setIsRevenueLens] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [lastGeneratedTaskId, setLastGeneratedTaskId] = useState<string | null>(null);
  const [lastExecutionResult, setLastExecutionResult] = useState<string | null>(null);

  // ProtoForge Pipeline - All concepts and revenue streams
  const [nodes] = useState<RoadmapNode[]>([
    // Core Infrastructure
    {
      id: 'hydi-core',
      title: 'HYDI Core System',
      description: 'Central orchestration engine for autonomous task management',
      chapter: 'Foundation',
      category: 'infrastructure',
      status: 'completed',
      connections: ['hydi-agents', 'task-orchestrator', 'project-ops'],
      icon: <Brain className="w-5 h-5" />
    },
    {
      id: 'project-ops',
      title: 'Project Ops API',
      description: 'Central model gateway and orchestration system',
      chapter: 'Foundation',
      category: 'infrastructure',
      status: 'completed',
      connections: ['hydi-core', 'local-models', 'task-generator'],
      icon: <Cpu className="w-5 h-5" />
    },
    {
      id: 'local-models',
      title: 'Local Ollama Models',
      description: 'qwen2.5-coder:1.5b, gemma3:4b, llama3.2:latest',
      chapter: 'Foundation',
      category: 'technology',
      status: 'completed',
      connections: ['project-ops', 'copilot', 'hydi-tasks'],
      icon: <Network className="w-5 h-5" />
    },

    // Agent Systems
    {
      id: 'hydi-agents',
      title: 'HYDI Agent Network',
      description: 'Six specialized autonomous agents for production pipeline',
      chapter: 'Agents',
      category: 'service',
      status: 'in-progress',
      connections: ['hydi-core', 'niche-scout', 'keyword-engine'],
      icon: <Users className="w-5 h-5" />
    },
    {
      id: 'niche-scout',
      title: 'Niche Scout Agent',
      description: 'Scans trends, analyzes keywords, ranks opportunities',
      chapter: 'Agents',
      category: 'service',
      status: 'planned',
      connections: ['hydi-agents', 'keyword-engine'],
      revenue: 'Trend analysis subscriptions',
      ttc: '30d',
      icon: <Target className="w-5 h-5" />
    },
    {
      id: 'keyword-engine',
      title: 'Keyword Engine Agent',
      description: 'Converts niches to datasets with location variants',
      chapter: 'Agents',
      category: 'service',
      status: 'planned',
      connections: ['niche-scout', 'site-factory'],
      icon: <FileText className="w-5 h-5" />
    },
    {
      id: 'site-factory',
      title: 'Site Factory Agent',
      description: 'Generates Next.js projects with SEO pages and schemas',
      chapter: 'Agents',
      category: 'service',
      status: 'planned',
      connections: ['keyword-engine', 'deployment-agent'],
      revenue: 'Automated site generation fees',
      ttc: '90d+',
      icon: <Code className="w-5 h-5" />
    },
    {
      id: 'deployment-agent',
      title: 'Deployment Agent',
      description: 'Pushes to Vercel/Cloudflare, verifies deployment',
      chapter: 'Agents',
      category: 'service',
      status: 'planned',
      connections: ['site-factory', 'traffic-monitor'],
      revenue: 'Deployment automation fees',
      icon: <Rocket className="w-5 h-5" />
    },
    {
      id: 'traffic-monitor',
      title: 'Traffic Monitor Agent',
      description: 'Tracks indexing, impressions, organic traffic',
      chapter: 'Distribution',
      category: 'service',
      status: 'planned',
      connections: ['deployment-agent', 'revenue-tracker'],
      icon: <TrendingUp className="w-5 h-5" />
    },
    {
      id: 'revenue-tracker',
      title: 'Revenue Tracker Agent',
      description: 'Measures monetization from affiliate networks',
      chapter: 'Revenue',
      category: 'revenue',
      status: 'planned',
      connections: ['traffic-monitor', 'revenue-dashboard'],
      revenue: 'Revenue tracking analytics',
      ttc: '90d+',
      icon: <DollarSign className="w-5 h-5" />
    },

    // Revenue Streams
    {
      id: 'payment-gateway',
      title: 'Payment Gateway PaaS',
      description: 'Stripe Connect platform with Express accounts',
      chapter: 'Revenue',
      category: 'revenue',
      status: 'completed',
      connections: ['hydi-core', 'payment-links', 'subscription-mgmt'],
      revenue: '$49/mo + 0.5% fees',
      ttc: '7d',
      icon: <CreditCard className="w-5 h-5" />
    },
    {
      id: 'payment-links',
      title: 'Payment Links Service',
      description: 'Quick payment link generation for existing products',
      chapter: 'Revenue',
      category: 'revenue',
      status: 'completed',
      connections: ['payment-gateway', 'revenue-dashboard'],
      revenue: 'Hobby $10/mo, Freelancer $20/mo, Hardware $15/mo',
      ttc: '7d',
      icon: <ShoppingBag className="w-5 h-5" />
    },
    {
      id: 'subscription-mgmt',
      title: 'Subscription Management',
      description: 'Automated recurring billing and customer lifecycle',
      chapter: 'Revenue',
      category: 'revenue',
      status: 'in-progress',
      connections: ['payment-gateway', 'revenue-dashboard'],
      revenue: 'SaaS subscriptions $29-199/mo',
      ttc: '30d',
      icon: <Clock className="w-5 h-5" />
    },

    // Technology Stack
    {
      id: 'copilot',
      title: 'Ursula Copilot',
      description: 'Voice-enabled AI assistant with HYDI integration',
      chapter: 'Foundation',
      category: 'technology',
      status: 'completed',
      connections: ['local-models', 'hydi-tasks', 'voice-commands'],
      icon: <Zap className="w-5 h-5" />
    },
    {
      id: 'hydi-tasks',
      title: 'HYDI Task Generation',
      description: 'Autonomous task creation and execution pipeline',
      chapter: 'Foundation',
      category: 'service',
      status: 'completed',
      connections: ['copilot', 'task-orchestrator'],
      revenue: 'Task automation fees',
      icon: <Lightbulb className="w-5 h-5" />
    },
    {
      id: 'task-orchestrator',
      title: 'Task Orchestrator',
      description: 'Coordinates agent execution and dependency management',
      chapter: 'Foundation',
      category: 'infrastructure',
      status: 'completed',
      connections: ['hydi-tasks', 'hydi-agents'],
      icon: <Network className="w-5 h-5" />
    },
    {
      id: 'voice-commands',
      title: 'Voice Command System',
      description: 'Hands-free interaction and voice automation',
      chapter: 'Foundation',
      category: 'technology',
      status: 'completed',
      connections: ['copilot', 'hydi-tasks'],
      revenue: 'Premium voice features',
      icon: <AlertCircle className="w-5 h-5" />
    },

    // Analytics & Dashboard
    {
      id: 'revenue-dashboard',
      title: 'Revenue Analytics Dashboard',
      description: 'Real-time revenue tracking and forecasting',
      chapter: 'Revenue',
      category: 'service',
      status: 'in-progress',
      connections: ['payment-gateway', 'revenue-tracker', 'subscription-mgmt'],
      icon: <PieChart className="w-5 h-5" />
    },

    // Vision Items
    {
      id: 'protoforge-marketplace',
      title: 'ProtoForge Marketplace',
      description: 'Platform for selling autonomous agents and workflows',
      chapter: 'Distribution',
      category: 'revenue',
      status: 'vision',
      connections: ['hydi-agents', 'site-factory'],
      revenue: 'Marketplace commission 15-20%',
      icon: <Building className="w-5 h-5" />
    },
    {
      id: 'global-network',
      title: 'Global Agent Network',
      description: 'Distributed HYDI agents across multiple regions',
      chapter: 'Distribution',
      category: 'infrastructure',
      status: 'vision',
      connections: ['hydi-agents', 'protoforge-marketplace'],
      revenue: 'Network participation fees',
      icon: <Globe className="w-5 h-5" />
    }
  ]);

  const chapters = useMemo(() => {
    const order: RoadmapNode['chapter'][] = ['Foundation', 'Agents', 'Revenue', 'Distribution'];
    return order.map(ch => ({
      id: ch,
      title: ch,
      nodes: nodes.filter(n => n.chapter === ch),
    }));
  }, [nodes]);

  const visibleNodes = useMemo(() => {
    return nodes.filter(n => {
      const statusOk = statusFilter === 'all' ? true : n.status === statusFilter;
      const categoryOk = categoryFilter === 'all' ? true : n.category === categoryFilter;
      return statusOk && categoryOk;
    });
  }, [nodes, statusFilter, categoryFilter]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  const criticalPathIds = useMemo(() => {
    // Basic, deterministic “first-$” path highlight
    return new Set<string>(['hydi-core', 'project-ops', 'local-models', 'copilot', 'hydi-tasks', 'task-orchestrator', 'payment-gateway', 'payment-links']);
  }, []);

  async function handleGenerateTask(node: RoadmapNode): Promise<void> {
    setIsBusy(true);
    setLastExecutionResult(null);
    try {
      const objective = `ProtoForge Roadmap: ${node.title} — ${node.description}`;
      const result = await projectOps.generateHYDITask(objective);
      if (!result.success || !result.task) throw new Error(result.error || 'Task generation failed');
      setLastGeneratedTaskId(String(result.task.id || ''));
      setLastExecutionResult(`Generated task: ${result.task.title || node.title}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastExecutionResult(`Generate failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExecuteTask(taskId: string): Promise<void> {
    setIsBusy(true);
    try {
      const result = await projectOps.executeHYDITask(taskId);
      if (!result.success || !result.result) throw new Error(result.error || 'Task execution failed');
      setLastExecutionResult(`Executed: ${result.result.status || 'completed'}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastExecutionResult(`Execute failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'in-progress': return 'bg-blue-500';
      case 'planned': return 'bg-yellow-500';
      case 'vision': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'revenue': return 'border-emerald-500';
      case 'technology': return 'border-blue-500';
      case 'service': return 'border-purple-500';
      case 'infrastructure': return 'border-orange-500';
      default: return 'border-gray-500';
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            ProtoForge Pipeline
          </h1>
          <p className="text-gray-400 text-sm">
            The Adjustment Bureau-inspired roadmap of autonomous revenue generation
          </p>
        </div>

        {/* Legend */}
        <div className="mb-6 flex flex-wrap justify-center gap-4 text-xs">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span>Completed</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span>In Progress</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <span>Planned</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
            <span>Vision</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
              <Filter className="w-4 h-4 text-gray-300" />
              <label className="text-xs text-gray-400">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="ml-2 bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-xs"
              >
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="in-progress">In Progress</option>
                <option value="planned">Planned</option>
                <option value="vision">Vision</option>
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
              <Layers className="w-4 h-4 text-gray-300" />
              <label className="text-xs text-gray-400">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as any)}
                className="ml-2 bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-xs"
              >
                <option value="all">All</option>
                <option value="revenue">Revenue</option>
                <option value="technology">Technology</option>
                <option value="service">Service</option>
                <option value="infrastructure">Infrastructure</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsRevenueLens(v => !v)}
            className={`px-3 py-2 rounded-lg border text-xs transition-colors ${isRevenueLens ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200' : 'bg-gray-800/50 border-gray-700 text-gray-200 hover:bg-gray-800'}`}
            title="Toggle revenue lens"
          >
            Revenue lens: {isRevenueLens ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Adjustment Bureau Plan Pages */}
        <div className="bg-gradient-to-br from-amber-950/10 via-gray-900 to-blue-950/10 rounded-xl border border-amber-800/30 backdrop-blur-sm overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-r from-amber-900/30 via-gray-800/40 to-blue-900/30 px-6 py-4 border-b border-amber-700/30">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-amber-200 tracking-wide">ProtoForge Pipeline Book</h2>
                <p className="text-xs text-amber-300/70 mt-1">Adjustment Bureau — curated plan pages</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-amber-300/60">
                <span>Pages {chapters.length}</span>
                <span>Revisions: 3</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Live
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 divide-x divide-amber-800/20">
            {chapters.map((ch, idx) => {
              const chapterNumber = idx + 1;
              const chapterNodes = ch.nodes.filter(n => visibleNodeIds.has(n.id));
              return (
                <div key={ch.id} className="relative">
                  {/* Chapter header as a page header */}
                  <div className="sticky top-0 z-10 bg-gradient-to-b from-amber-950/40 via-gray-900/60 to-transparent px-5 py-4 border-b border-amber-800/20">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-amber-300/40 text-xs font-mono">Page {chapterNumber}</span>
                          <span className="text-amber-200 text-sm font-semibold">{ch.title}</span>
                        </div>
                        <p className="text-xs text-amber-300/60 italic">“Focus lane”</p>
                      </div>
                      <div className="text-xs text-amber-300/40 font-mono">
                        {chapterNodes.length} items
                      </div>
                    </div>
                  </div>

                  {/* Narrative flow */}
                  <div className="px-5 py-4 space-y-4">
                    {chapterNodes.map((n, nodeIdx) => {
                      const isCritical = criticalPathIds.has(n.id);
                      const isLastInChapter = nodeIdx === chapterNodes.length - 1;
                      return (
                        <div key={n.id} className="relative">
                          {/* Connector line */}
                          {!isLastInChapter && (
                            <div className="absolute left-4 top-12 w-0.5 h-8 bg-gradient-to-b from-amber-700/30 to-transparent" />
                          )}

                          {/* Node card */}
                          <button
                            type="button"
                            onClick={() => setSelectedNode(n)}
                            className={`w-full text-left p-4 rounded-xl border transition-all duration-300 shadow-md hover:shadow-xl ${isCritical
                              ? 'border-amber-500/50 bg-gradient-to-br from-amber-900/20 to-orange-900/10 hover:from-amber-900/30 hover:to-orange-900/20 ring-1 ring-amber-500/20'
                              : 'border-gray-700/60 bg-gray-900/30 hover:bg-gray-800/40 hover:border-gray-600/60'
                              }`}
                          >
                            {/* Status ribbon */}
                            <div className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold border shadow-sm ${n.status === 'completed' ? 'bg-emerald-600 text-white border-emerald-500' :
                                n.status === 'in-progress' ? 'bg-blue-600 text-white border-blue-500' :
                                  n.status === 'planned' ? 'bg-amber-600 text-white border-amber-500' :
                                    'bg-purple-600 text-white border-purple-500'
                              }`}>
                              {n.status}
                            </div>

                            <div className="flex items-start gap-3">
                              <div className={`mt-1 p-2 rounded-lg border ${getCategoryColor(n.category)} bg-gray-900/60`}>
                                <div className="text-amber-300">{n.icon}</div>
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-white">{n.title}</div>
                                <div className="text-xs text-amber-300/70 mt-1 line-clamp-2">{n.description}</div>

                                {/* Revenue callout */}
                                {isRevenueLens && n.revenue && (
                                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-900/30 border border-emerald-700/40 text-[10px] text-emerald-300">
                                    <DollarSign className="w-3 h-3" />
                                    {n.revenue}
                                    {n.ttc && <span className="text-amber-300/60 ml-1">({n.ttc})</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>

                          {/* Chapter-to-chapter flow arrow */}
                          {isLastInChapter && idx < chapters.length - 1 && (
                            <div className="mt-4 flex items-center justify-center text-amber-400/30">
                              <ArrowRight className="w-5 h-5" />
                              <span className="text-xs ml-1">Continues</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend & Summary */}
        <div className="mt-6 flex flex-wrap gap-6 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-amber-300/60">Status ribbons:</span>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-600 border border-emerald-500"></span>
              <span className="text-gray-400">Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-600 border border-blue-500"></span>
              <span className="text-gray-400">In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-600 border border-amber-500"></span>
              <span className="text-gray-400">Planned</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-purple-600 border border-purple-500"></span>
              <span className="text-gray-400">Vision</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-amber-300/60">Critical path:</span>
            <div className="px-2 py-1 rounded-md border border-amber-500/50 bg-amber-900/20 text-amber-300 text-[10px]">
              Highlighted
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-amber-300/60">Revenue lens:</span>
            <span className={isRevenueLens ? 'text-emerald-300' : 'text-gray-400'}>
              {isRevenueLens ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Selected Node Details */}
        {selectedNode && (
          <div className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700 backdrop-blur-sm">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <div className={`p-2 rounded-lg ${getCategoryColor(selectedNode.category)} bg-gray-800`}>
                    {selectedNode.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selectedNode.title}</h3>
                    <div className="flex items-center space-x-2 text-sm text-gray-400">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(selectedNode.status)} bg-opacity-20`}>
                        {selectedNode.status}
                      </span>
                      <span className="capitalize">{selectedNode.category}</span>
                    </div>
                  </div>
                </div>

                <p className="text-gray-300 mb-3">{selectedNode.description}</p>

                {selectedNode.revenue && (
                  <div className="flex items-center space-x-2 text-emerald-400 font-medium">
                    <DollarSign className="w-4 h-4" />
                    <span>{selectedNode.revenue}</span>
                  </div>
                )}

                <div className="mt-3 text-sm text-gray-400">
                  <strong>Connections:</strong> {selectedNode.connections.join(', ')}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerateTask(selectedNode)}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-200 hover:bg-blue-600/30 disabled:opacity-50"
                  >
                    Generate HYDI task
                  </button>

                  <button
                    type="button"
                    onClick={() => lastGeneratedTaskId && handleExecuteTask(lastGeneratedTaskId)}
                    disabled={isBusy || !lastGeneratedTaskId}
                    className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Execute
                  </button>

                  {lastGeneratedTaskId && (
                    <div className="text-xs text-gray-400">Task ID: {lastGeneratedTaskId}</div>
                  )}
                </div>

                {lastExecutionResult && (
                  <div className="mt-3 text-sm text-gray-200 bg-gray-900/40 border border-gray-700 rounded-lg p-3">
                    {lastExecutionResult}
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedNode(null)}
                className="ml-4 text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Pipeline Summary */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center space-x-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold text-green-400">Completed</h3>
            </div>
            <div className="text-2xl font-bold text-white mb-1">
              {nodes.filter(n => n.status === 'completed').length}
            </div>
            <div className="text-xs text-gray-400">Systems operational</div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center space-x-2 mb-2">
              <Clock className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-blue-400">In Progress</h3>
            </div>
            <div className="text-2xl font-bold text-white mb-1">
              {nodes.filter(n => n.status === 'in-progress').length}
            </div>
            <div className="text-xs text-gray-400">Currently building</div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center space-x-2 mb-2">
              <Target className="w-5 h-5 text-yellow-400" />
              <h3 className="font-semibold text-yellow-400">Planned</h3>
            </div>
            <div className="text-2xl font-bold text-white mb-1">
              {nodes.filter(n => n.status === 'planned').length}
            </div>
            <div className="text-xs text-gray-400">Next quarter</div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center space-x-2 mb-2">
              <Lightbulb className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold text-purple-400">Vision</h3>
            </div>
            <div className="text-2xl font-bold text-white mb-1">
              {nodes.filter(n => n.status === 'vision').length}
            </div>
            <div className="text-xs text-gray-400">Future pipeline</div>
          </div>
        </div>

        {/* Revenue Projection */}
        <div className="mt-6 bg-gradient-to-r from-emerald-900/30 to-blue-900/30 rounded-lg p-6 border border-emerald-700/30">
          <h2 className="text-xl font-bold mb-4 text-emerald-400">Revenue Pipeline Projection</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Current Monthly</h3>
              <div className="text-2xl font-bold text-emerald-400">$0-5,000</div>
              <div className="text-xs text-gray-400">Payment gateway & services</div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">6-Month Target</h3>
              <div className="text-2xl font-bold text-blue-400">$10,000-25,000</div>
              <div className="text-xs text-gray-400">Agent automation & SaaS</div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">12-Month Vision</h3>
              <div className="text-2xl font-bold text-purple-400">$50,000-200,000</div>
              <div className="text-xs text-gray-400">Marketplace & global network</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProtoForgeRoadmapModule;
