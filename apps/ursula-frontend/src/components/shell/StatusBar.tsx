/**
 * StatusBar — VS Code bottom status strip
 * 
 * Shows system status, active module info, connection indicators,
 * and the test/live mode toggle switch.
 * 
 * Config: Mode toggle persists to localStorage via ModeContext.
 */
'use client';

import { GitBranch, Circle, Wifi, WifiOff, FlaskConical, Radio } from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface StatusBarProps {
  activeModule: string | null;
  connected?: boolean;
}

export default function StatusBar({ activeModule, connected = true }: StatusBarProps) {
  const { mode, isLive, toggleMode } = useMode();

  return (
    <div
      className="flex items-center justify-between px-3 text-[11px] font-mono select-none shrink-0"
      style={{
        height: 22,
        background: isLive ? '#1a7f37' : 'var(--bg-statusbar)',
        color: '#ffffff',
        transition: 'background 0.3s ease',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Mode Toggle */}
        <button
          onClick={toggleMode}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm transition-all hover:bg-white/15 active:scale-95"
          title={`Switch to ${isLive ? 'test' : 'live'} mode`}
        >
          {isLive ? (
            <>
              <Radio size={11} className="animate-pulse" />
              <span className="font-bold tracking-wider">LIVE</span>
            </>
          ) : (
            <>
              <FlaskConical size={11} />
              <span className="tracking-wider">TEST</span>
            </>
          )}
        </button>

        <span className="opacity-40">|</span>

        <span className="flex items-center gap-1">
          <GitBranch size={12} />
          main
        </span>
        <span className="flex items-center gap-1">
          <Circle size={8} fill={connected ? '#3fb950' : '#f85149'} strokeWidth={0} />
          {connected ? 'Connected' : 'Offline'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {activeModule && (
          <span className="opacity-80">{activeModule}</span>
        )}
        <span className="flex items-center gap-1">
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          ProtoForge Hub
        </span>
      </div>
    </div>
  );
}
