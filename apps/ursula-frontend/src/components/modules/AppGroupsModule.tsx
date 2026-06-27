/**
 * AppGroupsModule — Launch and manage grouped module collections
 * 
 * Allows users to "snap" multiple related modules together into cohesive app
 * experiences. For example, all Rezonate modules can be launched as a single
 * DAW app for testing.
 * 
 * Features:
 * - Browse available app groups (Rezonate, HydiPay, Dev Suite, etc.)
 * - Launch entire app group (opens all modules in tabs)
 * - View module composition of each group
 * - Quick access to frequently used app combinations
 */
'use client';

import { useState, useCallback } from 'react';
import {
  Layers,
  Music,
  CreditCard,
  Code,
  DollarSign,
  Zap,
  Printer,
  Bike,
  PenTool,
  Activity,
  Play,
  Grid3X3,
  List,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { MODULE_GROUPS, type ModuleGroup } from '@/lib/module-groups';
import { useModules } from '@/lib/use-modules';

// ─── Icon Mapping ────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.FC<{ size?: number; style?: React.CSSProperties }>> = {
  Music,
  CreditCard,
  Code,
  DollarSign,
  Zap,
  Printer,
  Bike,
  PenTool,
  Activity,
  Layers,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  product: { label: 'Product', color: '#3fb950' },
  service: { label: 'Service', color: '#58a6ff' },
  tool: { label: 'Tool', color: '#d29922' },
  suite: { label: 'Suite', color: '#a371f7' },
};

const LAYOUT_CONFIG = {
  tabs: { label: 'Tabs', icon: List },
  grid: { label: 'Grid', icon: Grid3X3 },
  split: { label: 'Split', icon: Layers },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AppGroupsModule() {
  const { openModule } = useModules();
  const [selectedGroup, setSelectedGroup] = useState<ModuleGroup | null>(MODULE_GROUPS[0]);
  const [filter, setFilter] = useState<'all' | 'product' | 'service' | 'tool' | 'suite'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Launch entire app group
  const launchGroup = useCallback((group: ModuleGroup) => {
    // Open all modules in the group
    group.modules.forEach(moduleId => {
      openModule(moduleId);
    });
  }, [openModule]);

  const filteredGroups = filter === 'all' 
    ? MODULE_GROUPS 
    : MODULE_GROUPS.filter(g => g.category === filter);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded" style={{ background: '#a371f720' }}>
            <Layers size={24} style={{ color: '#a371f7' }} />
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--fg-default)' }}>
              App Groups
            </h2>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              Snap modules together into complete app experiences
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className="p-2 rounded transition-all"
            style={{
              background: viewMode === 'grid' ? 'var(--bg-subtle)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--fg-default)' : 'var(--fg-muted)',
            }}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className="p-2 rounded transition-all"
            style={{
              background: viewMode === 'list' ? 'var(--bg-subtle)' : 'transparent',
              color: viewMode === 'list' ? 'var(--fg-default)' : 'var(--fg-muted)',
            }}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded" style={{ background: 'var(--bg-subtle)' }}>
          <div className="text-2xl font-bold" style={{ color: 'var(--fg-default)' }}>
            {MODULE_GROUPS.length}
          </div>
          <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>Total Groups</div>
        </div>
        <div className="p-4 rounded" style={{ background: 'var(--bg-subtle)' }}>
          <div className="text-2xl font-bold" style={{ color: '#3fb950' }}>
            {MODULE_GROUPS.filter(g => g.category === 'product').length}
          </div>
          <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>Products</div>
        </div>
        <div className="p-4 rounded" style={{ background: 'var(--bg-subtle)' }}>
          <div className="text-2xl font-bold" style={{ color: '#58a6ff' }}>
            {MODULE_GROUPS.filter(g => g.category === 'service').length}
          </div>
          <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>Services</div>
        </div>
        <div className="p-4 rounded" style={{ background: 'var(--bg-subtle)' }}>
          <div className="text-2xl font-bold" style={{ color: '#a371f7' }}>
            {MODULE_GROUPS.filter(g => g.category === 'suite').length}
          </div>
          <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>Suites</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(['all', 'product', 'service', 'tool', 'suite'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded text-sm transition-all"
            style={{
              background: filter === f ? 'var(--bg-subtle)' : 'transparent',
              color: filter === f ? 'var(--fg-default)' : 'var(--fg-muted)',
              border: `1px solid ${filter === f ? 'var(--border-default)' : 'transparent'}`,
            }}
          >
            {f === 'all' ? 'All Groups' : CATEGORY_CONFIG[f].label}
          </button>
        ))}
      </div>

      {/* Group List/Grid */}
      <div className={viewMode === 'grid' ? 'grid grid-cols-3 gap-4' : 'space-y-2'}>
        {filteredGroups.map(group => {
          const GroupIcon = ICON_MAP[group.icon] || Layers;
          const LayoutIcon = LAYOUT_CONFIG[group.layout || 'tabs'].icon;

          return (
            <div
              key={group.id}
              onClick={() => setSelectedGroup(group)}
              className="p-4 rounded cursor-pointer transition-all"
              style={{
                background: selectedGroup?.id === group.id ? 'var(--bg-subtle)' : 'transparent',
                border: `1px solid ${selectedGroup?.id === group.id ? 'var(--border-default)' : 'transparent'}`,
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded" style={{ background: `${group.color}20` }}>
                    <GroupIcon size={20} style={{ color: group.color }} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: 'var(--fg-default)' }}>
                      {group.name}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {group.modules.length} modules
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    launchGroup(group);
                  }}
                  className="p-1.5 rounded hover:opacity-80 transition-opacity"
                  style={{ background: `${group.color}20`, color: group.color }}
                >
                  <Play size={14} />
                </button>
              </div>

              <p className="text-xs mb-3" style={{ color: 'var(--fg-muted)' }}>
                {group.description}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded" style={{
                  background: `${CATEGORY_CONFIG[group.category].color}20`,
                  color: CATEGORY_CONFIG[group.category].color,
                }}>
                  {CATEGORY_CONFIG[group.category].label}
                </div>
                <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
                  <LayoutIcon size={12} />
                  <span>{LAYOUT_CONFIG[group.layout || 'tabs'].label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Group Details */}
      {selectedGroup && (
        <div className="mt-6 p-4 rounded" style={{ background: 'var(--bg-subtle)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold" style={{ color: 'var(--fg-default)' }}>
              {selectedGroup.name}
            </h3>
            <button
              onClick={() => launchGroup(selectedGroup)}
              className="px-4 py-2 rounded flex items-center gap-2 hover:opacity-80 transition-opacity"
              style={{ background: selectedGroup.color, color: '#fff' }}
            >
              <Play size={16} />
              Launch All Modules
            </button>
          </div>

          <p className="text-sm mb-4" style={{ color: 'var(--fg-muted)' }}>
            {selectedGroup.description}
          </p>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--fg-default)' }}>
              Included Modules ({selectedGroup.modules.length})
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {selectedGroup.modules.map(moduleId => (
                <button
                  key={moduleId}
                  onClick={() => openModule(moduleId)}
                  className="p-2 rounded text-left flex items-center justify-between hover:opacity-80 transition-all"
                  style={{ background: 'var(--bg-inset)' }}
                >
                  <span className="text-sm" style={{ color: 'var(--fg-default)' }}>
                    {moduleId}
                  </span>
                  <ExternalLink size={12} style={{ color: 'var(--fg-muted)' }} />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 p-3 rounded" style={{ background: 'var(--bg-inset)' }}>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--fg-default)' }}>
              Layout: {LAYOUT_CONFIG[selectedGroup.layout || 'tabs'].label}
            </div>
            <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {selectedGroup.layout === 'tabs' && 'Modules open in separate tabs for easy switching'}
              {selectedGroup.layout === 'grid' && 'Modules arranged in a grid layout for simultaneous viewing'}
              {selectedGroup.layout === 'split' && 'Modules split into panes for side-by-side work'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
