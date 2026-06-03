/**
 * ActivityBar — VS Code left icon strip
 * 
 * Renders vertical icon buttons for each registered module.
 * Click opens/focuses the module tab.
 * 
 * Config: Icons sourced from lucide-react via module registry.
 */
'use client';

import {
  LayoutDashboard,
  Bot,
  CreditCard,
  Globe,
  Terminal,
  Lightbulb,
  Crosshair,
  Grid3X3,
  Palette,
  Music,
  Package,
  Send,
  Box,
  Server,
  PenTool,
  Kanban,
  Workflow,
  Shield,
  Landmark,
  Brain,
  Printer,
  Bike,
  Briefcase,
  Activity,
  Mail,
  TrendingUp,
  Cpu,
  Map,
  Sparkles,
  Settings,
  type LucideIcon
} from 'lucide-react';
import clsx from 'clsx';
import type { UrsulaModule } from '@/lib/modules';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bot,
  CreditCard,
  Globe,
  Terminal,
  Lightbulb,
  Crosshair,
  Grid3X3,
  Palette,
  Music,
  Package,
  Mail,
  Send,
  Box,
  Server,
  PenTool,
  Kanban,
  Shield,
  Landmark,
  Brain,
  Printer,
  Bike,
  Briefcase,
  Activity,
  Workflow,
  Sparkles,
  Map,
  TrendingUp,
  Cpu,
};

interface ActivityBarProps {
  modules: UrsulaModule[];
  activeTab: string | null;
  onModuleClick: (id: string) => void;
  onSettingsClick: () => void;
}

export default function ActivityBar({
  modules,
  activeTab,
  onModuleClick,
  onSettingsClick,
}: ActivityBarProps) {
  const getModuleIconColor = (moduleId: string, isActive: boolean): string => {
    if (isActive) return 'text-[var(--icon-active)]';
    switch (moduleId) {
      case 'copilot': return 'text-[var(--icon-copilot)]';
      case 'roadmap': return 'text-[var(--icon-roadmap)]';
      case 'dashboard': return 'text-[var(--icon-dashboard)]';
      case 'payments': return 'text-[var(--icon-payments)]';
      case 'projects': return 'text-[var(--icon-projects)]';
      case 'settings': return 'text-[var(--icon-settings)]';
      default: return 'text-[var(--icon-default)]';
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-between py-1"
      style={{
        width: 48,
        minWidth: 48,
        background: 'var(--bg-activitybar)',
        borderRight: '1px solid var(--border-color)',
      }}
    >
      <div className="flex flex-col items-center gap-0.5">
        {modules.map((mod) => {
          const Icon = ICON_MAP[mod.icon];
          const isActive = activeTab === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => onModuleClick(mod.id)}
              title={mod.label}
              className={clsx(
                'relative flex items-center justify-center w-12 h-12 transition-colors',
                getModuleIconColor(mod.id, isActive),
                !isActive && 'hover:text-[var(--text-primary)]'
              )}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r"
                  style={{ background: 'var(--text-accent)' }}
                />
              )}
              {Icon && <Icon size={22} strokeWidth={1.5} />}
              {mod.badge && mod.badge > 0 && (
                <span className="absolute top-1.5 right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-[var(--text-accent)] text-white text-[10px] font-bold px-1">
                  {mod.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col items-center pb-2">
        <button
          onClick={onSettingsClick}
          title="Settings"
          className="flex items-center justify-center w-12 h-12 text-[var(--icon-settings)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Settings size={22} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
