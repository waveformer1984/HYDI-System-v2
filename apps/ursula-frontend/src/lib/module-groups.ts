/**
 * Module Groups — Collections of related modules that form complete apps
 * 
 * Allows "snapping" multiple modules together to create cohesive app experiences
 * within Ursula. For example, all Rezonate modules can be grouped into a single
 * DAW app view for testing.
 * 
 * Usage: Import MODULE_GROUPS to render app launcher and grouped views.
 */

export interface ModuleGroup {
  id: string;
  name: string;
  description: string;
  icon: string;           // Lucide icon name
  color: string;          // Hex color for branding
  modules: string[];      // Array of module IDs to include
  layout?: 'tabs' | 'grid' | 'split';  // How to arrange modules
  category: 'product' | 'service' | 'tool' | 'suite';
}

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: 'rezonate-suite',
    name: 'Rezonate DAW',
    description: 'Complete digital audio workstation with AI signal intelligence, blockchain rights management, and bot personalities',
    icon: 'Music',
    color: '#a371f7',
    modules: [
      'rezonette',      // Main DAW module
      'buildamind',     // AI personality platform for bot characters
      'ghostwriter',    // AI content creation for lyrics/scripts
      'branding',       // Brand assets and identity
      'llm',            // Local LLM models for AI features
    ],
    layout: 'tabs',
    category: 'product',
  },
  {
    id: 'payment-suite',
    name: 'HydiPay Suite',
    description: 'Complete payment processing platform with gateway, webhooks, and customer management',
    icon: 'CreditCard',
    color: '#3fb950',
    modules: [
      'payments',       // Payment gateway
      'cyber',          // Backend services
      'resend',         // Email notifications
      'automation',     // Payment automation
      'platformcli',    // Stripe CLI integration
    ],
    layout: 'grid',
    category: 'product',
  },
  {
    id: 'dev-suite',
    name: 'Development Suite',
    description: 'Complete development environment with IDE, terminal, agents, and task management',
    icon: 'Code',
    color: '#58a6ff',
    modules: [
      'terminal',       // Command bridge
      'agents',         // Agent roster
      'projectops',     // Project management
      'taskpipeline',   // Task queue
      'orchestration',  // Action approval
      'llm',            // Local models
    ],
    layout: 'split',
    category: 'tool',
  },
  {
    id: 'revenue-suite',
    name: 'Revenue Operations',
    description: 'Complete revenue generation platform with sales, automation, and launch tracking',
    icon: 'DollarSign',
    color: '#3fb950',
    modules: [
      'ursula',         // Sales dashboard
      'automation',     // Outreach automation
      'freelance',      // Job matching
      'launchinventory', // Launch readiness
      'payments',       // Payment processing
      'funding',        // Grant discovery
    ],
    layout: 'tabs',
    category: 'suite',
  },
  {
    id: 'task-suite',
    name: 'Task Automation Suite',
    description: 'Complete task management with generation, execution, and monitoring',
    icon: 'Zap',
    color: '#f0883e',
    modules: [
      'taskgen',        // Task generator
      'agentexec',      // Agent executor
      'taskpipeline',   // Task pipeline
      'orchestration',  // Approval queue
      'agents',         // Agent roster
    ],
    layout: 'tabs',
    category: 'suite',
  },
  {
    id: '3d-suite',
    name: '3D Design & Print',
    description: 'Complete 3D design and printing workflow with CAD, slicing, and print management',
    icon: 'Printer',
    color: '#d29922',
    modules: [
      'sketchpad',      // 2D/3D CAD
      'tactical',       // 3D print studio
      'inventory',      // Product catalog
      'branding',       // Brand assets
    ],
    layout: 'grid',
    category: 'product',
  },
  {
    id: 'zaero-suite',
    name: 'Z-AERO Project',
    description: 'Complete EV motorcycle conversion project tracker with build logs and milestones',
    icon: 'Bike',
    color: '#58a6ff',
    modules: [
      'zaero',          // Build tracker
      'sketchpad',      // CAD designs
      'tactical',       // 3D printed parts
      'funding',        // Grant applications
    ],
    layout: 'tabs',
    category: 'product',
  },
  {
    id: 'content-suite',
    name: 'Content Creation Suite',
    description: 'Complete content creation platform with AI writing, branding, and automation',
    icon: 'PenTool',
    color: '#a371f7',
    modules: [
      'ghostwriter',    // AI content creation
      'branding',       // Brand identity
      'llm',            // Local models
      'automation',     // Content automation
      'resend',         // Email distribution
    ],
    layout: 'tabs',
    category: 'service',
  },
  {
    id: 'monitoring-suite',
    name: 'System Monitoring',
    description: 'Complete system health monitoring with overview, agents, and infrastructure',
    icon: 'Activity',
    color: '#58a6ff',
    modules: [
      'overview',       // System overview
      'agents',         // Agent status
      'nodes',          // Node mesh
      'terminal',       // System logs
      'platformcli',    // Platform status
    ],
    layout: 'grid',
    category: 'tool',
  },
];

/**
 * Get all modules in a group
 */
export function getGroupModules(groupId: string): string[] {
  const group = MODULE_GROUPS.find(g => g.id === groupId);
  return group?.modules || [];
}

/**
 * Get group by ID
 */
export function getGroup(groupId: string): ModuleGroup | undefined {
  return MODULE_GROUPS.find(g => g.id === groupId);
}

/**
 * Get all groups containing a specific module
 */
export function getGroupsForModule(moduleId: string): ModuleGroup[] {
  return MODULE_GROUPS.filter(g => g.modules.includes(moduleId));
}
