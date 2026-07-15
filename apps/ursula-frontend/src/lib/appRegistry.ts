/**
 * App Registry - Centralized catalog of all HYDI System apps and functions
 * Auto-generated from build registry and workspace scan
 */

export interface AppMetadata {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: 'nodejs' | 'python' | 'service' | 'tool';
  category: 'development' | 'payment' | 'ai' | 'infrastructure' | 'revenue' | 'content' | 'utility';
  path: string;
  port?: number;
  url?: string;
  devCommand?: string;
  buildCommand?: string;
  status: 'active' | 'inactive' | 'pending';
  icon?: string;
  tags: string[];
}

export const APP_REGISTRY: AppMetadata[] = [
  // Core Infrastructure
  {
    id: 'ursula',
    name: 'ursula',
    displayName: 'Ursula IDE',
    description: 'VS Code-style IDE interface with 21 integrated modules',
    type: 'nodejs',
    category: 'development',
    path: 'C:\\Users\\Owner\\HYDI_System\\ursula',
    port: 3000,
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    status: 'active',
    icon: '🖥️',
    tags: ['ide', 'development', 'core']
  },
  {
    id: 'hydi-pay',
    name: 'HydiPay',
    displayName: 'HYDI Payment Gateway',
    description: 'Multi-provider payment processing (Stripe, PayPal, Square)',
    type: 'python',
    category: 'payment',
    path: 'C:\\Users\\Owner\\HYDI_System\\HydiPay',
    url: 'https://api.protoforgeindustries.com',
    status: 'active',
    icon: '💳',
    tags: ['payment', 'stripe', 'paypal', 'api']
  },
  {
    id: 'orchestrator',
    name: 'orchestrator',
    displayName: 'HYDI Orchestrator',
    description: 'Task execution and coordination engine',
    type: 'python',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\orchestrator',
    port: 8002,
    status: 'active',
    icon: '🎯',
    tags: ['orchestration', 'tasks', 'automation']
  },

  // AI & Content Generation
  {
    id: 'ghostwriter-agent',
    name: '@protoforge/ghostwriter-agent',
    displayName: 'Ghostwriter Agent',
    description: 'Narrative intelligence layer for Build-A-Mind',
    type: 'nodejs',
    category: 'ai',
    path: 'C:\\Users\\Owner\\HYDI_System\\apps\\ghostwriter-agent',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '✍️',
    tags: ['ai', 'narrative', 'content']
  },
  {
    id: 'ai-auditor',
    name: 'ai-auditor',
    displayName: 'AI Auditor',
    description: 'AI-powered code and system auditing tool',
    type: 'nodejs',
    category: 'development',
    path: 'C:\\Users\\Owner\\HYDI_System\\ai-auditor',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🔍',
    tags: ['ai', 'audit', 'security']
  },
  {
    id: 'episode-generator',
    name: 'episode-generator',
    displayName: 'Episode Generator',
    description: 'Automated content episode generation',
    type: 'nodejs',
    category: 'content',
    path: 'C:\\Users\\Owner\\HYDI_System\\apps\\episode-generator',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🎬',
    tags: ['content', 'generation', 'media']
  },

  // Revenue & Business
  {
    id: 'hmh-desktop',
    name: 'HMH Desktop App',
    displayName: 'HMH Revenue Dashboard',
    description: 'Revenue tracking and business management',
    type: 'nodejs',
    category: 'revenue',
    path: 'C:\\Users\\Owner\\HYDI_System\\HMH_Desktop_App',
    status: 'pending',
    icon: '💰',
    tags: ['revenue', 'business', 'dashboard']
  },
  {
    id: 'alpha-fund',
    name: 'copy-of-dataforge-alpha-fund-dashboard',
    displayName: 'Alpha Fund Dashboard',
    description: 'Investment and fund management dashboard',
    type: 'nodejs',
    category: 'revenue',
    path: 'C:\\Users\\Owner\\HYDI_System\\apps\\alphaFund',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '📈',
    tags: ['finance', 'investment', 'dashboard']
  },

  // Development Tools
  {
    id: 'forgefinder',
    name: 'forgefinder',
    displayName: 'ForgeForgin',
    description: 'Code discovery and navigation tool',
    type: 'nodejs',
    category: 'development',
    path: 'C:\\Users\\Owner\\HYDI_System\\apps\\ForgeForgin',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🔧',
    tags: ['development', 'tools', 'search']
  },
  {
    id: 'gitthis',
    name: 'gitthis-cyber-management',
    displayName: 'GitThis Cyber Management',
    description: 'Git workflow and cyber security management',
    type: 'nodejs',
    category: 'development',
    path: 'C:\\Users\\Owner\\HYDI_System\\app\\gitThis uix',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🔐',
    tags: ['git', 'security', 'management']
  },

  // Infrastructure & APIs
  {
    id: 'api-gateway',
    name: 'api-gateway',
    displayName: 'API Gateway',
    description: 'Central API routing and management',
    type: 'nodejs',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\api-gateway',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🌐',
    tags: ['api', 'gateway', 'routing']
  },
  {
    id: 'hydi-router-api',
    name: 'hydi-router-api',
    displayName: 'HYDI Router API',
    description: 'Request routing and API management',
    type: 'nodejs',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\api',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🔀',
    tags: ['api', 'router', 'infrastructure']
  },
  {
    id: 'webhook-relay',
    name: 'webhook-relay',
    displayName: 'Webhook Relay',
    description: 'Webhook forwarding and management service',
    type: 'nodejs',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\webhook-relay',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '📡',
    tags: ['webhook', 'relay', 'integration']
  },

  // Specialized Apps
  {
    id: 'protoforge-vr-hq',
    name: 'protoforge-vr-hq',
    displayName: 'ProtoForge VR HQ',
    description: 'Virtual reality headquarters interface',
    type: 'nodejs',
    category: 'utility',
    path: 'C:\\Users\\Owner\\HYDI_System',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '🥽',
    tags: ['vr', 'interface', 'visualization']
  },
  {
    id: 'beta-portal',
    name: 'auto_stack_beta_portal',
    displayName: 'Beta Portal',
    description: 'Beta testing and user management portal',
    type: 'nodejs',
    category: 'utility',
    path: 'C:\\Users\\Owner\\HYDI_System\\auto_stack_beta_portal',
    url: 'https://beta.protoforgeindustries.com',
    buildCommand: 'npm run build',
    status: 'active',
    icon: '🚀',
    tags: ['beta', 'testing', 'portal']
  },
  {
    id: 'subscription-starter',
    name: 'subscription-starter',
    displayName: 'Subscription Starter',
    description: 'Subscription management and billing',
    type: 'nodejs',
    category: 'payment',
    path: 'C:\\Users\\Owner\\HYDI_System\\apps\\subscription-starter',
    buildCommand: 'npm run build',
    status: 'pending',
    icon: '📋',
    tags: ['subscription', 'billing', 'saas']
  },

  // Python Services
  {
    id: 'hydi-runtime',
    name: 'hydi',
    displayName: 'HYDI Runtime',
    description: 'Core HYDI runtime and automation engine',
    type: 'python',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\hydi',
    status: 'active',
    icon: '⚙️',
    tags: ['runtime', 'automation', 'core']
  },
  {
    id: 'market-rnd',
    name: 'market_rnd_system',
    displayName: 'Market R&D System',
    description: 'Market research and development automation',
    type: 'python',
    category: 'revenue',
    path: 'C:\\Users\\Owner\\HYDI_System\\market_rnd_system',
    status: 'pending',
    icon: '📊',
    tags: ['market', 'research', 'automation']
  },
  {
    id: 'protoforge-platform',
    name: 'protoforge-platform',
    displayName: 'ProtoForge Platform',
    description: 'Core platform infrastructure and services',
    type: 'python',
    category: 'infrastructure',
    path: 'C:\\Users\\Owner\\HYDI_System\\protoforge-platform',
    status: 'pending',
    icon: '🏗️',
    tags: ['platform', 'infrastructure', 'core']
  }
];

export const getAppsByCategory = (category: AppMetadata['category']) => {
  return APP_REGISTRY.filter(app => app.category === category);
};

export const getActiveApps = () => {
  return APP_REGISTRY.filter(app => app.status === 'active');
};

export const searchApps = (query: string) => {
  const lowerQuery = query.toLowerCase();
  return APP_REGISTRY.filter(app => 
    app.name.toLowerCase().includes(lowerQuery) ||
    app.displayName.toLowerCase().includes(lowerQuery) ||
    app.description.toLowerCase().includes(lowerQuery) ||
    app.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
};

export const getAppById = (id: string) => {
  return APP_REGISTRY.find(app => app.id === id);
};

export const CATEGORIES = [
  { id: 'development', name: 'Development', icon: '💻' },
  { id: 'payment', name: 'Payment', icon: '💳' },
  { id: 'ai', name: 'AI & ML', icon: '🤖' },
  { id: 'infrastructure', name: 'Infrastructure', icon: '🏗️' },
  { id: 'revenue', name: 'Revenue', icon: '💰' },
  { id: 'content', name: 'Content', icon: '📝' },
  { id: 'utility', name: 'Utility', icon: '🔧' }
] as const;
