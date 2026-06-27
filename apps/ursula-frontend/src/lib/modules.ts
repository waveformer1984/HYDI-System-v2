/**
 * Ursula Module Registry
 * 
 * Each module represents a "tab" in the VS Code-style frame.
 * To add a new module, add an entry here and create a matching
 * component in src/components/modules/.
 * 
 * Usage: Import MODULES array to render activity bar icons and route to panels.
 * Config: Set `default: true` on exactly one module to show on launch.
 */

export interface UrsulaModule {
  id: string;
  label: string;
  icon: string;           // Lucide icon name
  description: string;
  default?: boolean;
  badge?: number;         // notification count
  category: 'core' | 'service' | 'tool';
}

export const MODULES: UrsulaModule[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'LayoutDashboard',
    description: 'ProtoForge system overview and status',
    default: true,
    category: 'core',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'Bot',
    description: 'Agent roster, status, and logs',
    category: 'core',
  },
  {
    id: 'payments',
    label: 'Payments',
    icon: 'CreditCard',
    description: 'HydiPay & Stripe payment gateway',
    category: 'service',
  },
  {
    id: 'sitegrade',
    label: 'SiteGrade AI',
    icon: 'Globe',
    description: 'AI website auditor reports',
    category: 'service',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'Terminal',
    description: 'Command bridge and system logs',
    category: 'tool',
  },
  {
    id: 'ideas',
    label: 'Idea Workshop',
    icon: 'Lightbulb',
    description: 'Brainstorm board with idea cards and kanban flow',
    category: 'tool',
  },
  {
    id: 'situation',
    label: 'Situation Room',
    icon: 'Crosshair',
    description: 'Roadmap visualizer with milestones and blockers',
    category: 'core',
  },
  {
    id: 'concepts',
    label: 'Concept Matrix',
    icon: 'Grid3X3',
    description: 'Grid of concepts with maturity, connections, and status',
    category: 'core',
  },
  {
    id: 'branding',
    label: 'Branding',
    icon: 'Palette',
    description: 'Brand assets, colors, typography, and identity',
    category: 'tool',
  },
  {
    id: 'rezonette',
    label: 'Rezonate DAW',
    icon: 'Music',
    description: 'Next-gen DAW — AI signal intelligence, blockchain rights, bot personalities',
    category: 'service',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'Package',
    description: 'Master catalog of every app, concept, and marketable product',
    category: 'core',
    badge: 87,
  },
  {
    id: 'sketchpad',
    label: 'SketchPad',
    icon: 'Box',
    description: '2D sketching & 3D CAD modeling — FreeCAD integration, STL export, print prep',
    category: 'tool',
  },
  {
    id: 'nodes',
    label: 'Node Mesh',
    icon: 'Server',
    description: 'HYDRA distributed compute mesh — coordinator + worker nodes',
    category: 'core',
  },
  {
    id: 'ghostwriter',
    label: 'Ghostwriter',
    icon: 'PenTool',
    description: 'AI content creation — ghostwriting, tone matching, RAVE training',
    category: 'service',
  },
  {
    id: 'projectops',
    label: 'Project Ops',
    icon: 'Kanban',
    description: 'Task management, agent routing, risk scoring, and expediting',
    category: 'core',
  },
  {
    id: 'orchestration',
    label: 'Orchestration',
    icon: 'Workflow',
    description: 'Approval-gated Heidi action queue — request, approve, execute, and logs',
    category: 'core',
  },
  {
    id: 'cyber',
    label: 'Cyber Services',
    icon: 'Shield',
    description: 'Main FastAPI backend — payments, webhooks, node coordination',
    category: 'core',
  },
  {
    id: 'funding',
    label: 'Funding Hub',
    icon: 'Landmark',
    description: 'Grant discovery, application management, capital acquisition',
    category: 'service',
  },
  {
    id: 'buildamind',
    label: 'Build-A-Mind',
    icon: 'Brain',
    description: 'AI personality platform — characters, episodes, RAVE integration',
    category: 'service',
  },
  {
    id: 'tactical',
    label: '3D Print Studio',
    icon: 'Printer',
    description: 'Instrument cases, cable management, EDC gear — Etsy storefront',
    category: 'service',
  },
  {
    id: 'zaero',
    label: 'Z-AERO',
    icon: 'Bike',
    description: 'GS550 cafe racer EV conversion — build tracker and milestones',
    category: 'service',
  },
  {
    id: 'freelance',
    label: 'Freelance',
    icon: 'Briefcase',
    description: 'Job matching, lead qualification, AI proposal generation',
    category: 'service',
  },
  {
    id: 'checkpoints',
    label: 'Checkpoints',
    icon: 'Activity',
    description: 'Vector checkpoint echo system — long-duration task progress tracking',
    category: 'tool',
  },
  {
    id: 'llm',
    label: 'Model Gateway',
    icon: 'Brain',
    description: 'Local LLM models — chat, generate, decompose, copilot via Ollama',
    category: 'core',
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: 'Send',
    description: 'Outreach, response, and onboarding automation — prospect pipeline and email sequences',
    category: 'service',
  },
  {
    id: 'resend',
    label: 'Resend Email',
    icon: 'Mail',
    description: 'Resend email platform — compose, send, domain verification, and email audit log',
    category: 'service',
  },
  {
    id: 'ursula',
    label: 'Ursula Sales',
    icon: 'TrendingUp',
    description: 'Client acquisition dashboard — sales funnel, outreach templates, and revenue tracking',
    category: 'core',
    badge: 12,
  },
  {
    id: 'platformcli',
    label: 'Platform CLI',
    icon: 'Cpu',
    description: 'Unified CLI dashboard — GitHub, Railway, Supabase, Stripe, Postman, PayPal, Netlify, Vercel, Ollama',
    category: 'core',
    badge: 9,
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    icon: 'Map',
    description: 'Embedded Roadmap app (Vite) with Firebase sync',
    category: 'core',
  },
  {
    id: 'copilot',
    label: 'Copilot',
    icon: 'Sparkles',
    description: 'AI assistant with voice input/output and HYDI task integration',
    category: 'tool',
  },
];

export default MODULES;
