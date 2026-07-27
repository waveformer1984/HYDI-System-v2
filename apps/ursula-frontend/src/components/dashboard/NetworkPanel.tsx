'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Wifi, Globe, Server, Network } from 'lucide-react';

function typeIcon(type: string) {
  switch (type) {
    case 'tailscale':
      return <Network className="h-4 w-4" />;
    case 'local':
      return <Server className="h-4 w-4" />;
    case 'bridge':
      return <Wifi className="h-4 w-4" />;
    default:
      return <Globe className="h-4 w-4" />;
  }
}

export function NetworkPanel() {
  const { network } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wifi className="h-5 w-5" />
          Network
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {network.map((node) => (
            <div
              key={node.name}
              className={`rounded-md border p-4 ${node.healthy ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <div className="flex items-center gap-2">
                {typeIcon(node.type)}
                <div className="font-semibold">{node.name}</div>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {node.address}
                {node.port ? `:${node.port}` : ''}
              </div>
              <div className="text-xs text-muted-foreground mt-1 capitalize">{node.type}</div>
            </div>
          ))}
          {network.length === 0 && <div className="text-muted-foreground col-span-full">No network nodes discovered.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
