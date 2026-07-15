/**
 * Ursula Module State Hook
 * 
 * Manages which modules (tabs) are open and which is active.
 * Uses React state — no external store dependency.
 * 
 * Usage: const { openTabs, activeTab, openModule, closeTab, setActive } = useModules()
 */
'use client';

import { useState, useCallback } from 'react';
import { MODULES, type UrsulaModule } from './modules';

export interface UseModulesReturn {
  modules: UrsulaModule[];
  openTabs: UrsulaModule[];
  activeTab: string | null;
  openModule: (id: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
}

export function useModules(): UseModulesReturn {
  const defaultModule = MODULES.find(m => m.default);
  const [openTabIds, setOpenTabIds] = useState<string[]>(
    defaultModule ? [defaultModule.id] : []
  );
  const [activeTab, setActiveTab] = useState<string | null>(
    defaultModule?.id ?? null
  );

  const openModule = useCallback((id: string) => {
    setOpenTabIds(prev => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
    setActiveTab(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabIds(prev => {
      const next = prev.filter(t => t !== id);
      return next;
    });
    setActiveTab(prev => {
      if (prev === id) {
        const remaining = openTabIds.filter(t => t !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return prev;
    });
  }, [openTabIds]);

  const setActive = useCallback((id: string) => {
    setActiveTab(id);
  }, []);

  const openTabs = openTabIds
    .map(id => MODULES.find(m => m.id === id))
    .filter((m): m is UrsulaModule => m !== undefined);

  return {
    modules: MODULES,
    openTabs,
    activeTab,
    openModule,
    closeTab,
    setActive,
  };
}
