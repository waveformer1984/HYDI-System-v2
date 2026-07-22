'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Bot, CheckCircle, AlertCircle, Loader, PauseCircle } from 'lucide-react';

function stateIcon(state: string) {
  switch (state) {
    case 'running':
      return <Loader className="h-4 w-4 animate-spin text-blue-500" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'idle':
      return <PauseCircle className="h-4 w-4 text-yellow-500" />;
    default:
      return <CheckCircle className="h-4 w-4 text-gray-500" />;
  }
}

export function AgentStatusPanel() {
  const { agents } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bot className="h-5 w-5" />
          Agent Runtime
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <div key={agent.name} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{agent.name}</div>
                {stateIcon(agent.state)}
              </div>
              <div className="mt-2 text-sm text-muted-foreground capitalize">{agent.state}</div>
              <div className="text-sm">Tasks: {agent.tasks}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Heartbeat {new Date(agent.lastHeartbeat).toLocaleTimeString()}
              </div>
            </div>
          ))}
          {agents.length === 0 && <div className="text-muted-foreground col-span-full">No agent status available.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
