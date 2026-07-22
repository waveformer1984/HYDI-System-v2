'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useMode } from '@/lib/mode-context';
import type { BusEvent, DashboardState, Notification, Task, AgentRuntime, AIModel, NetworkNode, RevenueSummary, SystemHealth, EventFabricState, MemoryState } from './types';

function now(): string {
  return new Date().toISOString();
}

const initialSystemHealth: SystemHealth = {
  cpu: { name: 'CPU', value: 0, unit: '%', status: 'unknown', timestamp: now() },
  memory: { name: 'Memory', value: 0, unit: '%', status: 'unknown', timestamp: now() },
  disk: { name: 'Disk', value: 0, unit: '%', status: 'unknown', timestamp: now() },
  uptime: { name: 'Uptime', value: '0s', status: 'unknown', timestamp: now() },
  services: [],
};

const initialEventFabric: EventFabricState = {
  events: [],
  subscriptions: [],
  replayActive: false,
  totalEvents: 0,
};

const initialMemory: MemoryState = {
  episodic: 0,
  semantic: 0,
  vector: 0,
};

const initialState: DashboardState = {
  connected: false,
  lastUpdate: now(),
  mode: 'test',
  systemHealth: initialSystemHealth,
  eventFabric: initialEventFabric,
  agents: [],
  models: [],
  memory: initialMemory,
  tasks: [],
  network: [],
  revenue: [],
  notifications: [],
  logs: [],
};

interface DashboardContextValue extends DashboardState {
  toggleMode: () => void;
  acknowledgeNotification: (id: string) => void;
  clearNotifications: () => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  ...initialState,
  toggleMode: () => {},
  acknowledgeNotification: () => {},
  clearNotifications: () => {},
});

const MAX_EVENTS = 250;
const MAX_LOGS = 100;

function applyEvent(state: DashboardState, event: BusEvent): DashboardState {
  if (state.eventFabric.events.some((e) => e.id === event.id)) {
    return state;
  }

  switch (event.type) {
    case 'system:health': {
      const health = event.payload as SystemHealth;
      return { ...state, systemHealth: health, lastUpdate: now() };
    }
    case 'event:fabric': {
      const fabric = event.payload as EventFabricState;
      return { ...state, eventFabric: fabric, lastUpdate: now() };
    }
    case 'agent:status': {
      const agent = event.payload as AgentRuntime;
      const agents = state.agents.filter((a) => a.name !== agent.name);
      return { ...state, agents: [...agents, agent].sort((a, b) => a.name.localeCompare(b.name)), lastUpdate: now() };
    }
    case 'model:status': {
      const model = event.payload as AIModel;
      const models = state.models.filter((m) => m.id !== model.id);
      return { ...state, models: [...models, model].sort((a, b) => a.id.localeCompare(b.id)), lastUpdate: now() };
    }
    case 'memory:status': {
      const memory = event.payload as MemoryState;
      return { ...state, memory, lastUpdate: now() };
    }
    case 'tasks:update': {
      const tasks = event.payload as Task[];
      return { ...state, tasks, lastUpdate: now() };
    }
    case 'network:status': {
      const network = event.payload as NetworkNode[];
      return { ...state, network, lastUpdate: now() };
    }
    case 'revenue:summary': {
      const revenue = event.payload as RevenueSummary;
      const existing = state.revenue.filter((r) => r.revenueStream !== revenue.revenueStream);
      return { ...state, revenue: [...existing, revenue].sort((a, b) => a.revenueStream.localeCompare(b.revenueStream)), lastUpdate: now() };
    }
    case 'notification': {
      const notification = event.payload as Notification;
      if (state.notifications.some((n) => n.id === notification.id)) return state;
      const notifications = [notification, ...state.notifications].slice(0, 50);
      return { ...state, notifications, lastUpdate: now() };
    }
    case 'log:line': {
      const line = (event.payload as { message: string }).message;
      const logs = [line, ...state.logs].slice(0, MAX_LOGS);
      return { ...state, logs, lastUpdate: now() };
    }
    default: {
      // Capture any event on the event fabric panel
      const events = [event, ...state.eventFabric.events].slice(0, MAX_EVENTS);
      const fabric = { ...state.eventFabric, events, totalEvents: state.eventFabric.totalEvents + 1 };
      return { ...state, eventFabric: fabric, lastUpdate: now() };
    }
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { mode, setMode } = useMode();
  const [state, setState] = useState<DashboardState>({ ...initialState, mode });
  const esRef = useRef<EventSource | null>(null);

  const toggleMode = useCallback(() => {
    setMode(mode === 'test' ? 'live' : 'test');
  }, [mode, setMode]);

  const acknowledgeNotification = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.id === id ? { ...n, acknowledged: true } : n)),
    }));
  }, []);

  const clearNotifications = useCallback(() => {
    setState((prev) => ({ ...prev, notifications: [] }));
  }, []);

  useEffect(() => {
    setState((prev) => ({ ...prev, mode }));
  }, [mode]);

  useEffect(() => {
    let es: EventSource | null = null;

    async function bootstrap() {
      try {
        const res = await fetch('/api/events/recent?limit=250');
        if (res.ok) {
          const { events } = (await res.json()) as { events: BusEvent[] };
          // Apply oldest-first so derived state ends at the latest snapshot.
          events.reverse().forEach((event) => {
            setState((prev) => applyEvent(prev, event));
          });
        }
      } catch (err) {
        console.error('[Dashboard] Failed to seed recent events:', err);
      }

      es = new EventSource('/api/events/stream');
      esRef.current = es;

      es.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as BusEvent;
          setState((prev) => applyEvent(prev, event));
        } catch (err) {
          console.error('[Dashboard] Failed to parse SSE event:', err);
        }
      };

      es.onerror = () => {
        setState((prev) => ({ ...prev, connected: false }));
      };
    }

    bootstrap();

    return () => {
      es?.close();
      esRef.current = null;
    };
  }, []);

  const value: DashboardContextValue = {
    ...state,
    toggleMode,
    acknowledgeNotification,
    clearNotifications,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  return useContext(DashboardContext);
}
