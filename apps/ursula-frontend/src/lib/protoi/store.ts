import { ProtoProject, ProtoTemplate } from './types';

class ProtoIStore {
  projects: Map<string, ProtoProject> = new Map();
  templates: Map<string, ProtoTemplate> = new Map();
  initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const now = new Date().toISOString();

    // Seed demo templates
    this.templates.set('tpl-saas', {
      id: 'tpl-saas',
      name: 'SaaS Product Launch',
      description: 'End-to-end blueprint for launching a software-as-a-service product.',
      category: 'software',
      defaultTasks: [
        { title: 'Market research & validation', description: 'Identify target audience and validate demand', status: 'done', priority: 'high' },
        { title: 'MVP scoping', description: 'Define minimum viable feature set', status: 'done', priority: 'high' },
        { title: 'Architecture design', description: 'System design and tech stack selection', status: 'done', priority: 'high' },
        { title: 'Core backend API', description: 'Build REST/GraphQL API with auth', status: 'in_progress', priority: 'high' },
        { title: 'Frontend dashboard', description: 'React/Next.js customer-facing UI', status: 'todo', priority: 'high' },
        { title: 'Stripe integration', description: 'Payments, subscriptions, webhooks', status: 'todo', priority: 'medium' },
        { title: 'Beta launch', description: 'Private beta with 10 pilot customers', status: 'backlog', priority: 'medium' },
        { title: 'Public launch', description: 'Product Hunt, HN, SEO push', status: 'backlog', priority: 'medium' },
      ],
      defaultMilestones: [
        { title: 'Design Complete', description: 'Architecture and UX finalized', dueDate: '', status: 'pending' },
        { title: 'MVP Built', description: 'Core features working end-to-end', dueDate: '', status: 'pending' },
        { title: 'First Paying Customer', description: 'Revenue event', dueDate: '', status: 'pending' },
      ],
      defaultResources: [
        { name: 'Development Hours', type: 'time', unit: 'hours', allocated: 400, used: 120, notes: 'Est. 400h for MVP' },
        { name: 'Cloud Budget', type: 'budget', unit: 'USD', allocated: 500, used: 45, notes: 'Vercel + AWS free tier initially' },
        { name: 'Designer', type: 'person', allocated: 1, used: 0.5, notes: 'Part-time UI/UX' },
      ],
    });

    this.templates.set('tpl-container', {
      id: 'tpl-container',
      name: 'Cyberpunk Container Skyscraper',
      description: 'Design, fund, build and operate a rotating container skyscraper.',
      category: 'construction',
      defaultTasks: [
        { title: 'Site survey & zoning', description: 'Legal and environmental clearance', status: 'backlog', priority: 'critical' },
        { title: 'Structural engineering', description: 'Load analysis and rotation mechanism', status: 'backlog', priority: 'critical' },
        { title: 'Container procurement', description: 'Source 200+ recycled shipping containers', status: 'backlog', priority: 'high' },
        { title: 'Energy system design', description: 'Solar + wind + grid hybrid', status: 'backlog', priority: 'high' },
        { title: 'Module fabrication', description: 'Prefabricate residential units off-site', status: 'backlog', priority: 'medium' },
        { title: 'Vertical assembly', description: 'Crane-stacking and rotation mount', status: 'backlog', priority: 'medium' },
      ],
      defaultMilestones: [
        { title: 'Funding Secured', description: '$10M seed round or grant', dueDate: '', status: 'pending' },
        { title: 'Foundation Complete', description: 'Rotating base operational', dueDate: '', status: 'pending' },
        { title: 'First Residents', description: 'Certificate of occupancy', dueDate: '', status: 'pending' },
      ],
      defaultResources: [
        { name: 'Steel Containers', type: 'material', quantity: 240, unit: 'units', allocated: 240, used: 0, notes: 'Recycled 40ft containers' },
        { name: 'Capital', type: 'budget', unit: 'USD', allocated: 10000000, used: 0, notes: 'Target: grants + private equity' },
        { name: 'Engineering Team', type: 'person', allocated: 12, used: 0, notes: 'Structural, MEP, architects' },
      ],
    });

    // Seed demo project from SaaS template
    const projectId = 'proj-001';
    const tpl = this.templates.get('tpl-saas')!;
    this.projects.set(projectId, {
      id: projectId,
      title: 'HYDI System Consolidation',
      description: 'Merge Ursula frontend, Heidi orchestrator, and ProtoForge into a single operational platform.',
      category: 'software',
      status: 'active',
      priority: 'critical',
      ownerId: 'user-001',
      startDate: '2026-06-01',
      targetDate: '2026-06-15',
      budget: 5000,
      spent: 450,
      milestones: tpl.defaultMilestones.map((m, i) => ({ ...m, id: `ms-${i}`, status: i === 0 ? 'achieved' : 'pending' })),
      tasks: tpl.defaultTasks.map((t, i) => ({ ...t, id: `task-${i}`, createdAt: now, status: i < 3 ? 'done' : i === 3 ? 'in_progress' : 'todo' })),
      resources: tpl.defaultResources.map((r, i) => ({ ...r, id: `res-${i}` })),
      logs: [
        { id: 'log-1', type: 'note', content: 'Frontend build passed. Next.js 15 route handler types fixed.', createdAt: now, createdBy: 'user-001' },
        { id: 'log-2', type: 'note', content: 'PM2 ecosystem fully operational. All 5 processes online.', createdAt: now, createdBy: 'user-001' },
        { id: 'log-3', type: 'metric', content: 'Resonate audio engine scaffolded and deployed to /resonate.', createdAt: now, createdBy: 'user-001' },
      ],
      createdAt: now,
      updatedAt: now,
    });
  }
}

export const protoIStore = new ProtoIStore();
