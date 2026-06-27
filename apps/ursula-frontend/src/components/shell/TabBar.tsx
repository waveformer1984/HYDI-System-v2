/**
 * TabBar — VS Code editor tab strip
 * 
 * Shows open module tabs with close buttons.
 * Active tab is visually highlighted.
 * 
 * Usage: Rendered at top of editor area, driven by useModules() state.
 */
'use client';

import { X } from 'lucide-react';
import clsx from 'clsx';
import type { UrsulaModule } from '@/lib/modules';

interface TabBarProps {
  tabs: UrsulaModule[];
  activeTab: string | null;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
}

export default function TabBar({ tabs, activeTab, onTabClick, onTabClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-end overflow-x-auto"
      style={{
        background: 'var(--bg-tab)',
        borderBottom: '1px solid var(--border-color)',
        minHeight: 35,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => onTabClick(tab.id)}
            className={clsx(
              'group flex items-center gap-2 px-3 h-[35px] cursor-pointer border-r text-[13px] select-none shrink-0',
              isActive
                ? 'text-[var(--text-active)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
            style={{
              background: isActive ? 'var(--bg-tab-active)' : 'transparent',
              borderRightColor: 'var(--border-color)',
              borderTop: isActive ? '1px solid var(--text-accent)' : '1px solid transparent',
            }}
          >
            <span className="font-mono text-[12px] whitespace-nowrap">{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className={clsx(
                'flex items-center justify-center w-5 h-5 rounded-sm transition-colors',
                isActive
                  ? 'hover:bg-white/10'
                  : 'opacity-0 group-hover:opacity-100 hover:bg-white/10'
              )}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
