'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Brain, Database, Layers, Zap } from 'lucide-react';

export function MemoryPanel() {
  const { memory } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5" />
          Memory
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Database className="h-4 w-4" /> Episodic
            </div>
            <div className="text-2xl font-bold">{memory.episodic}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Layers className="h-4 w-4" /> Semantic
            </div>
            <div className="text-2xl font-bold">{memory.semantic}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Zap className="h-4 w-4" /> Vector
            </div>
            <div className="text-2xl font-bold">{memory.vector}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-muted-foreground text-sm">Retrieval Latency</div>
            <div className="text-2xl font-bold">
              {memory.retrievalLatencyMs ?? '—'}
              {typeof memory.retrievalLatencyMs === 'number' && <span className="text-sm font-normal text-muted-foreground ml-1">ms</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
