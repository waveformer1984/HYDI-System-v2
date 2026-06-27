/**
 * Workspace Consolidation System
 * 
 * Consolidates related modules into unified workspaces with snapshot/preview capabilities.
 * Reduces sidebar clutter by grouping similar functionality.
 */

export interface WorkspaceSnapshot {
  id: string;
  timestamp: number;
  moduleId: string;
  title: string;
  preview: string;        // Text preview or data summary
  thumbnail?: string;     // Optional screenshot/visual
}

export interface ConsolidatedWorkspace {
  id: string;
  label: string;
  icon: string;
  description: string;
  category: 'core' | 'service' | 'tool';
  modules: string[];      // Module IDs included in this workspace
  layout: 'tabs' | 'split' | 'grid';
  snapshots?: WorkspaceSnapshot[];
  badge?: number;
}

/**
 * Consolidated Workspaces - Reduces 33 modules to ~12 workspaces
 */
export const CONSOLIDATED_WORKSPACES: ConsolidatedWorkspace[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    description: 'System overview, agents, and platform status',
    category: 'core',
    modules: ['overview', 'agents', 'platformcli', 'nodes'],
    layout: 'grid',
  },
  {
    id: 'tasks',
    label: 'Task Hub',
    icon: 'CheckSquare',
    description: 'Task generation, execution, pipeline, and orchestration',
    category: 'core',
    modules: ['taskgen', 'agentexec', 'taskpipeline', 'orchestration', 'projectops'],
    layout: 'tabs',
    badge: 8,
  },
  {
    id: 'dev',
    label: 'Dev Tools',
    icon: 'Code',
    description: 'Terminal, LLM models, and development utilities',
    category: 'tool',
    modules: ['terminal', 'llm', 'cyber', 'checkpoints'],
    layout: 'split',
  },
  {
    id: 'products',
    label: 'Products',
    icon: 'Package',
    description: 'Product inventory, launch readiness, and app groups',
    category: 'core',
    modules: ['inventory', 'launchinventory', 'appgroups', 'applauncher'],
    layout: 'tabs',
    badge: 153, // 87 + 66
  },
  {
    id: 'revenue',
    label: 'Revenue',
    icon: 'DollarSign',
    description: 'Sales, payments, automation, and funding',
    category: 'core',
    modules: ['ursula', 'payments', 'automation', 'funding', 'freelance'],
    layout: 'tabs',
    badge: 12,
  },
  {
    id: 'creative',
    label: 'Creative Studio',
    icon: 'Palette',
    description: 'Rezonate DAW, Build-A-Mind, Ghostwriter, and branding',
    category: 'service',
    modules: ['rezonette', 'buildamind', 'ghostwriter', 'branding'],
    layout: 'tabs',
  },
  {
    id: 'design',
    label: '3D Design',
    icon: 'Box',
    description: 'SketchPad CAD, 3D printing, and Z-AERO project',
    category: 'tool',
    modules: ['sketchpad', 'tactical', 'zaero'],
    layout: 'tabs',
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: 'Target',
    description: 'Ideas, situation room, concept matrix, and roadmap',
    category: 'core',
    modules: ['ideas', 'situation', 'concepts'],
    layout: 'grid',
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: 'Mail',
    description: 'Email, automation, and AI assistants',
    category: 'service',
    modules: ['resend', 'hydi', 'ursula_bot'],
    layout: 'tabs',
    badge: 8,
  },
  {
    id: 'services',
    label: 'Services',
    icon: 'Globe',
    description: 'SiteGrade AI and external service integrations',
    category: 'service',
    modules: ['sitegrade'],
    layout: 'tabs',
  },
];

/**
 * Get workspace by ID
 */
export function getWorkspace(workspaceId: string): ConsolidatedWorkspace | undefined {
  return CONSOLIDATED_WORKSPACES.find(w => w.id === workspaceId);
}

/**
 * Get workspace containing a specific module
 */
export function getWorkspaceForModule(moduleId: string): ConsolidatedWorkspace | undefined {
  return CONSOLIDATED_WORKSPACES.find(w => w.modules.includes(moduleId));
}

/**
 * Get all modules in a workspace
 */
export function getWorkspaceModules(workspaceId: string): string[] {
  const workspace = getWorkspace(workspaceId);
  return workspace?.modules || [];
}

/**
 * Create a snapshot of current workspace state
 */
export function createSnapshot(
  moduleId: string,
  title: string,
  preview: string,
  thumbnail?: string
): WorkspaceSnapshot {
  return {
    id: `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    moduleId,
    title,
    preview,
    thumbnail,
  };
}

/**
 * Snapshot storage (in-memory for now, could be localStorage)
 */
const snapshotStore = new Map<string, WorkspaceSnapshot[]>();

/**
 * Save snapshot to workspace
 */
export function saveSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot): void {
  const snapshots = snapshotStore.get(workspaceId) || [];
  snapshots.unshift(snapshot); // Add to beginning
  
  // Keep only last 10 snapshots per workspace
  if (snapshots.length > 10) {
    snapshots.pop();
  }
  
  snapshotStore.set(workspaceId, snapshots);
}

/**
 * Get snapshots for workspace
 */
export function getSnapshots(workspaceId: string): WorkspaceSnapshot[] {
  return snapshotStore.get(workspaceId) || [];
}

/**
 * Delete snapshot
 */
export function deleteSnapshot(workspaceId: string, snapshotId: string): void {
  const snapshots = snapshotStore.get(workspaceId) || [];
  const filtered = snapshots.filter(s => s.id !== snapshotId);
  snapshotStore.set(workspaceId, filtered);
}

/**
 * Clear all snapshots for workspace
 */
export function clearSnapshots(workspaceId: string): void {
  snapshotStore.delete(workspaceId);
}
