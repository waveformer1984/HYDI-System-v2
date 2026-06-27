/**
 * WorkspaceModule — Consolidated workspace with snapshot capabilities
 * 
 * Combines multiple related modules into a unified workspace with:
 * - Tab navigation between included modules
 * - Snapshot/preview system for saving workspace states
 * - Quick access to recent snapshots
 * - Layout options (tabs, split, grid)
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Camera,
  Clock,
  Trash2,
  ExternalLink,
  Grid3X3,
  Columns,
  List,
  ChevronRight,
} from 'lucide-react';
import { 
  type ConsolidatedWorkspace,
  type WorkspaceSnapshot,
  getSnapshots,
  saveSnapshot,
  deleteSnapshot,
  createSnapshot,
} from '@/lib/workspace-consolidation';
import { useModules } from '@/lib/use-modules';

interface WorkspaceModuleProps {
  workspace: ConsolidatedWorkspace;
}

export default function WorkspaceModule({ workspace }: WorkspaceModuleProps) {
  const { openModule } = useModules();
  const [activeModuleId, setActiveModuleId] = useState(workspace.modules[0]);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotTitle, setSnapshotTitle] = useState('');

  // Load snapshots on mount
  useEffect(() => {
    setSnapshots(getSnapshots(workspace.id));
  }, [workspace.id]);

  // Create snapshot
  const handleCreateSnapshot = useCallback(() => {
    if (!snapshotTitle.trim()) return;

    const snapshot = createSnapshot(
      activeModuleId,
      snapshotTitle.trim(),
      `Snapshot of ${activeModuleId} at ${new Date().toLocaleString()}`,
    );

    saveSnapshot(workspace.id, snapshot);
    setSnapshots(getSnapshots(workspace.id));
    setSnapshotTitle('');
  }, [workspace.id, activeModuleId, snapshotTitle]);

  // Delete snapshot
  const handleDeleteSnapshot = useCallback((snapshotId: string) => {
    deleteSnapshot(workspace.id, snapshotId);
    setSnapshots(getSnapshots(workspace.id));
  }, [workspace.id]);

  // Restore snapshot (open the module)
  const handleRestoreSnapshot = useCallback((snapshot: WorkspaceSnapshot) => {
    setActiveModuleId(snapshot.moduleId);
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--fg-default)' }}>
            {workspace.label}
          </h2>
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {workspace.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSnapshots(!showSnapshots)}
            className="px-3 py-1.5 rounded flex items-center gap-2 transition-all"
            style={{
              background: showSnapshots ? 'var(--bg-subtle)' : 'transparent',
              color: showSnapshots ? 'var(--fg-default)' : 'var(--fg-muted)',
              border: `1px solid ${showSnapshots ? 'var(--border-default)' : 'transparent'}`,
            }}
          >
            <Camera size={14} />
            Snapshots ({snapshots.length})
          </button>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto" style={{ borderColor: 'var(--border-color)' }}>
        {workspace.modules.map(moduleId => (
          <button
            key={moduleId}
            onClick={() => setActiveModuleId(moduleId)}
            className="px-3 py-1.5 rounded text-sm transition-all whitespace-nowrap"
            style={{
              background: activeModuleId === moduleId ? 'var(--bg-subtle)' : 'transparent',
              color: activeModuleId === moduleId ? 'var(--fg-default)' : 'var(--fg-muted)',
              border: `1px solid ${activeModuleId === moduleId ? 'var(--border-default)' : 'transparent'}`,
            }}
          >
            {moduleId}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--fg-default)' }}>
              {activeModuleId}
            </h3>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              Module content would be rendered here. Click "Open in Tab" to view the full module.
            </p>
          </div>

          {/* Snapshot Creation */}
          <div className="p-4 rounded mb-6" style={{ background: 'var(--bg-subtle)' }}>
            <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--fg-default)' }}>
              Create Snapshot
            </h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={snapshotTitle}
                onChange={(e) => setSnapshotTitle(e.target.value)}
                placeholder="Snapshot title..."
                className="flex-1 px-3 py-2 rounded text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--fg-default)',
                  border: '1px solid var(--border-default)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSnapshot();
                }}
              />
              <button
                onClick={handleCreateSnapshot}
                disabled={!snapshotTitle.trim()}
                className="px-4 py-2 rounded text-sm flex items-center gap-2 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--text-accent)', color: '#fff' }}
              >
                <Camera size={14} />
                Capture
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--fg-muted)' }}>
              Save current workspace state for quick access later
            </p>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => openModule(activeModuleId)}
              className="p-4 rounded text-left hover:opacity-80 transition-all"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <ExternalLink size={16} style={{ color: 'var(--text-accent)', marginBottom: '8px' }} />
              <div className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
                Open in Tab
              </div>
              <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                Open {activeModuleId} in separate tab
              </div>
            </button>

            <button
              onClick={() => workspace.modules.forEach(m => openModule(m))}
              className="p-4 rounded text-left hover:opacity-80 transition-all"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <Grid3X3 size={16} style={{ color: 'var(--text-accent)', marginBottom: '8px' }} />
              <div className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
                Open All
              </div>
              <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                Open all {workspace.modules.length} modules
              </div>
            </button>
          </div>
        </div>

        {/* Snapshots Sidebar */}
        {showSnapshots && (
          <div 
            className="w-80 border-l overflow-y-auto p-4"
            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-subtle)' }}
          >
            <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--fg-default)' }}>
              Snapshots ({snapshots.length})
            </h4>

            {snapshots.length === 0 ? (
              <div className="text-center py-8">
                <Camera size={32} style={{ color: 'var(--fg-muted)', margin: '0 auto 12px' }} />
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  No snapshots yet
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
                  Create a snapshot to save workspace state
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {snapshots.map(snapshot => (
                  <div
                    key={snapshot.id}
                    className="p-3 rounded cursor-pointer hover:opacity-80 transition-all"
                    style={{ background: 'var(--bg-inset)' }}
                    onClick={() => handleRestoreSnapshot(snapshot)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
                          {snapshot.title}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                          {snapshot.moduleId}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSnapshot(snapshot.id);
                        }}
                        className="p-1 rounded hover:bg-red-500/20 transition-colors"
                      >
                        <Trash2 size={12} style={{ color: '#f85149' }} />
                      </button>
                    </div>

                    <div className="text-xs mb-2" style={{ color: 'var(--fg-muted)' }}>
                      {snapshot.preview}
                    </div>

                    <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
                      <Clock size={10} />
                      {new Date(snapshot.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
