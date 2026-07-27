'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import {
  SystemHealthPanel,
  EventFabricPanel,
  AgentStatusPanel,
  TaskQueuePanel,
  MemoryPanel,
  RevenuePanel,
  ProtoForgePanel,
  ModelManagerPanel,
  NetworkPanel,
  LogsPanel,
  NotificationsPanel,
  SettingsPanel,
} from '@/components/dashboard';
import { Activity, Layers, Bot, ListTodo, Brain, Coins, Shield, Cpu, Wifi, Terminal, Bell, Settings } from 'lucide-react';

export default function OperatorDashboard() {
  const { connected, lastUpdate, mode, notifications } = useDashboard();

  const unacknowledged = notifications.filter((n) => !n.acknowledged).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Ursula — Unified Operations Console</h1>
            <p className="text-sm text-muted-foreground">
              NEXUS Phase 3 · {mode === 'live' ? 'Live' : 'Test'} mode · Updated {new Date(lastUpdate).toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
              {connected ? 'Event Fabric connected' : 'Reconnecting'}
            </div>
            {unacknowledged > 0 && (
              <div className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
                {unacknowledged} alert{unacknowledged === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 md:p-6">
        <Tabs defaultValue="health" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="health" className="flex items-center gap-1.5">
              <Activity className="h-4 w-4" /> System Health
            </TabsTrigger>
            <TabsTrigger value="fabric" className="flex items-center gap-1.5">
              <Layers className="h-4 w-4" /> Event Fabric
            </TabsTrigger>
            <TabsTrigger value="agents" className="flex items-center gap-1.5">
              <Bot className="h-4 w-4" /> Agents
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center gap-1.5">
              <ListTodo className="h-4 w-4" /> Tasks
            </TabsTrigger>
            <TabsTrigger value="models" className="flex items-center gap-1.5">
              <Cpu className="h-4 w-4" /> Models
            </TabsTrigger>
            <TabsTrigger value="memory" className="flex items-center gap-1.5">
              <Brain className="h-4 w-4" /> Memory
            </TabsTrigger>
            <TabsTrigger value="network" className="flex items-center gap-1.5">
              <Wifi className="h-4 w-4" /> Network
            </TabsTrigger>
            <TabsTrigger value="revenue" className="flex items-center gap-1.5">
              <Coins className="h-4 w-4" /> Revenue
            </TabsTrigger>
            <TabsTrigger value="governance" className="flex items-center gap-1.5">
              <Shield className="h-4 w-4" /> Governance
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-1.5">
              <Terminal className="h-4 w-4" /> Logs
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-1.5">
              <Bell className="h-4 w-4" /> Notifications
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-1.5">
              <Settings className="h-4 w-4" /> Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="health"><SystemHealthPanel /></TabsContent>
          <TabsContent value="fabric"><EventFabricPanel /></TabsContent>
          <TabsContent value="agents"><AgentStatusPanel /></TabsContent>
          <TabsContent value="tasks"><TaskQueuePanel /></TabsContent>
          <TabsContent value="models"><ModelManagerPanel /></TabsContent>
          <TabsContent value="memory"><MemoryPanel /></TabsContent>
          <TabsContent value="network"><NetworkPanel /></TabsContent>
          <TabsContent value="revenue"><RevenuePanel /></TabsContent>
          <TabsContent value="governance"><ProtoForgePanel /></TabsContent>
          <TabsContent value="logs"><LogsPanel /></TabsContent>
          <TabsContent value="notifications"><NotificationsPanel /></TabsContent>
          <TabsContent value="settings"><SettingsPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
