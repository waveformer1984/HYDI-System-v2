'use client';

import { HYDIChat } from '@/components/ui/hydi-chat';
import { Bot, Activity, Zap, Shield } from 'lucide-react';
import { useMode } from '@/lib/mode-context';

export default function HYDIModule() {
  const { isLive } = useMode();
  const effectiveLive = isLive || process.env.NEXT_PUBLIC_PHASE1_FORCE_LIVE === 'true';
  return (
    <div className="h-full flex flex-col bg-[var(--bg-editor)]">
      {/* Module Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
        <Bot className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">HYDI Assistant</h2>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${effectiveLive ? 'bg-green-500 animate-pulse' : 'bg-blue-500'}`} />
          <span className="text-xs text-[var(--text-secondary)]">{effectiveLive ? 'Online (live)' : 'Online (test)'}</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-[var(--text-secondary)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">Quick Actions</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] rounded text-sm text-[var(--text-primary)] transition-colors">
            <Zap className="w-4 h-4 text-yellow-500" />
            Payment Links
          </button>
          <button className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] rounded text-sm text-[var(--text-primary)] transition-colors">
            <Shield className="w-4 h-4 text-green-500" />
            Security Scan
          </button>
        </div>
      </div>

      {/* Chat Interface */}
      <div className="flex-1 p-4 overflow-hidden">
        <HYDIChat className="h-full" />
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--bg-statusbar)]">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <div className="flex items-center gap-4">
            <span>Tasks: 12 active</span>
            <span>Webhooks: 4 connected</span>
            <span>Revenue: $300 ready</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${effectiveLive ? 'bg-green-500' : 'bg-blue-500'}`} />
            <span>{effectiveLive ? 'HYDI Systems Operational (live)' : 'HYDI Systems Operational (test)'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
