/**
 * Mode Context — Global test/live mode toggle for Ursula
 * 
 * Provides a context that all modules can consume to switch between
 * mock seed data (test mode) and real API calls (live mode).
 * 
 * Usage:
 *   const { mode, toggleMode, isLive } = useMode();
 *   if (isLive) { fetch real data } else { use mock data }
 * 
 * Config: Default mode is 'test'. Toggle persists in localStorage.
 * Error handling: Falls back to 'test' if localStorage unavailable.
 */
'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AppMode = 'test' | 'live';

interface ModeContextValue {
  mode: AppMode;
  isLive: boolean;
  isTest: boolean;
  toggleMode: () => void;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: 'test',
  isLive: false,
  isTest: true,
  toggleMode: () => {},
  setMode: () => {},
});

const STORAGE_KEY = 'ursula-mode';

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('test');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'live' || stored === 'test') {
        setModeState(stored);
      }
    } catch {
      // localStorage unavailable, stay in test mode
    }
  }, []);

  const setMode = useCallback((newMode: AppMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // silent fail
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'test' ? 'live' : 'test');
  }, [mode, setMode]);

  return (
    <ModeContext.Provider
      value={{
        mode,
        isLive: mode === 'live',
        isTest: mode === 'test',
        toggleMode,
        setMode,
      }}
    >
      {children}
    </ModeContext.Provider>
  );
}

export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}
