/**
 * WorkspaceFrame — Consolidated workspace view with sidebar
 * 
 * Alternative to IDEFrame that uses consolidated workspaces instead of individual modules.
 * Reduces 33 modules to ~10 workspaces for cleaner navigation.
 */
'use client';

import { useState } from 'react';
import { CONSOLIDATED_WORKSPACES, type ConsolidatedWorkspace } from '@/lib/workspace-consolidation';
import WorkspaceModule from '@/components/modules/WorkspaceModule';
import * as Icons from 'lucide-react';

export default function WorkspaceFrame() {
  const [activeWorkspace, setActiveWorkspace] = useState<ConsolidatedWorkspace>(CONSOLIDATED_WORKSPACES[0]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <div 
        className="w-16 flex flex-col items-center py-4 gap-2"
        style={{ background: 'var(--bg-activitybar)' }}
      >
        {CONSOLIDATED_WORKSPACES.map(workspace => {
          const IconComponent = (Icons as any)[workspace.icon] || Icons.Box;
          const isActive = activeWorkspace.id === workspace.id;

          return (
            <button
              key={workspace.id}
              onClick={() => setActiveWorkspace(workspace)}
              className="relative w-12 h-12 flex items-center justify-center rounded transition-all"
              style={{
                background: isActive ? 'var(--bg-subtle)' : 'transparent',
                color: isActive ? 'var(--icon-active)' : 'var(--icon-inactive)',
              }}
              title={workspace.label}
            >
              <IconComponent size={24} />
              {workspace.badge && (
                <div
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs flex items-center justify-center font-semibold"
                  style={{ background: '#f85149', color: '#fff' }}
                >
                  {workspace.badge > 99 ? '99+' : workspace.badge}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <WorkspaceModule workspace={activeWorkspace} />
      </div>
    </div>
  );
}
