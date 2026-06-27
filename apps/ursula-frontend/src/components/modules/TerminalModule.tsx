/**
 * TerminalModule — Command bridge and system log viewer
 * 
 * VS Code-style integrated terminal panel.
 * Shows system logs and accepts commands.
 * 
 * TEST mode: status command returns mock data.
 * LIVE mode: status command pings real service endpoints.
 * 
 * Error handling: Displays connection status in terminal header.
 */
'use client';

import { useState, useRef, useEffect } from 'react';
import { Terminal, ChevronRight, FlaskConical, Radio } from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import { pingService } from '@/lib/api';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'system';
  message: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'var(--text-primary)',
  warn: '#d29922',
  error: '#f85149',
  system: 'var(--text-accent)',
};

const LIVE_SERVICES = [
  { name: 'Payment Gateway', url: 'https://web-services-production-55bf.up.railway.app/health' },
];

export default function TerminalModule() {
  const { isLive, mode, toggleMode } = useMode();

  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: new Date().toISOString(), level: 'system', message: 'Ursula v0.1.0 — ProtoForge Command Center' },
    { timestamp: new Date().toISOString(), level: 'system', message: 'Module system initialized. 9 modules loaded.' },
    { timestamp: new Date().toISOString(), level: 'info', message: 'Ready. Type "help" for available commands.' },
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const log = (level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, { timestamp: new Date().toISOString(), level, message }]);
  };

  const handleCommand = async (cmd: string) => {
    const trimmed = cmd.trim().toLowerCase();
    setInput('');

    log('info', `$ ${cmd}`);

    if (trimmed === 'help') {
      log('system', 'Available commands:');
      log('system', '  help        — Show this message');
      log('system', '  status      — Show service status (live pings in LIVE mode)');
      log('system', '  mode        — Show current mode (test/live)');
      log('system', '  toggle      — Switch between test and live mode');
      log('system', '  ping <url>  — Ping a URL (LIVE mode only)');
      log('system', '  clear       — Clear terminal');
      log('system', '  version     — Show version info');
    } else if (trimmed === 'clear') {
      setLogs([]);
    } else if (trimmed === 'version') {
      log('system', 'Ursula v0.1.0 // ProtoForge Hub // Next.js + Vercel');
    } else if (trimmed === 'mode') {
      log('system', `Current mode: ${mode.toUpperCase()}`);
      log('system', isLive ? 'Commands will hit real service endpoints.' : 'Commands will return mock/seed data.');
    } else if (trimmed === 'toggle') {
      toggleMode();
      const newMode = isLive ? 'TEST' : 'LIVE';
      log('system', `Mode switched to ${newMode}`);
    } else if (trimmed === 'status') {
      if (isLive) {
        log('system', 'Pinging services...');
        for (const svc of LIVE_SERVICES) {
          const result = await pingService(svc.url);
          if (result.ok) {
            log('info', `${svc.name}: ONLINE (${result.ms}ms)`);
          } else {
            log('error', `${svc.name}: OFFLINE — ${result.error}`);
          }
        }
        log('warn', 'Agent Network:   No health endpoint configured');
        log('warn', 'SiteGrade AI:    No health endpoint configured');
        log('system', 'Live health check complete.');
      } else {
        log('info', 'Payment Gateway: ONLINE (Railway) [mock]');
        log('info', 'Supabase:        ONLINE [mock]');
        log('warn', 'Agent Network:   UNKNOWN [mock]');
        log('warn', 'SiteGrade AI:    UNKNOWN [mock]');
        log('system', 'Switch to LIVE mode for real pings: type "toggle"');
      }
    } else if (trimmed.startsWith('ping ')) {
      const url = cmd.trim().substring(5).trim();
      if (!isLive) {
        log('warn', 'Ping requires LIVE mode. Type "toggle" to switch.');
      } else if (!url) {
        log('error', 'Usage: ping <url>');
      } else {
        log('system', `Pinging ${url}...`);
        const result = await pingService(url);
        if (result.ok) {
          log('info', `${url}: REACHABLE (${result.ms}ms)`);
        } else {
          log('error', `${url}: UNREACHABLE — ${result.error}`);
        }
      }
    } else {
      log('error', `Unknown command: ${trimmed}`);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-panel)' }}>
      {/* Terminal header */}
      <div
        className="flex items-center justify-between px-4 py-1.5 text-[11px] font-mono border-b shrink-0"
        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          TERMINAL
        </div>
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
          style={{
            background: isLive ? '#3fb95020' : '#007acc20',
            color: isLive ? '#3fb950' : '#007acc',
          }}
        >
          {isLive ? <><Radio size={8} /> LIVE</> : <><FlaskConical size={8} /> TEST</>}
        </span>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-5">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span style={{ color: 'var(--text-secondary)' }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span style={{ color: LEVEL_COLORS[log.level] }}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-t shrink-0"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <ChevronRight size={12} style={{ color: isLive ? '#3fb950' : 'var(--text-accent)' }} />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              handleCommand(input);
            }
          }}
          placeholder={isLive ? 'Live mode — commands hit real endpoints...' : 'Test mode — type a command...'}
          className="flex-1 bg-transparent text-[12px] font-mono outline-none"
          style={{ color: 'var(--text-primary)' }}
          autoFocus
        />
      </div>
    </div>
  );
}
