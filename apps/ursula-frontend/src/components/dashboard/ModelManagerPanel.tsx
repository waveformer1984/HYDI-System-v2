'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Cpu, CheckCircle, XCircle } from 'lucide-react';

export function ModelManagerPanel() {
  const { models } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Cpu className="h-5 w-5" />
          AI Models
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <div key={model.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold truncate" title={model.id}>
                  {model.id}
                </div>
                {model.loaded ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
              </div>
              <div className="text-sm text-muted-foreground mt-1 capitalize">{model.provider}</div>
              <div className="text-sm mt-2">Latency: {model.latencyMs ?? '—'} ms</div>
              <div className="text-sm">Tokens: {model.tokensUsed?.toLocaleString() ?? '—'}</div>
            </div>
          ))}
          {models.length === 0 && <div className="text-muted-foreground col-span-full">No model status available.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
