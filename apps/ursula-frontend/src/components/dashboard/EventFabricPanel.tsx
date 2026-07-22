'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Layers, Radio } from 'lucide-react';

export function EventFabricPanel() {
  const { eventFabric, connected } = useDashboard();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Radio className={`h-4 w-4 ${connected ? 'text-green-500' : 'text-red-500'}`} />
          {connected ? 'Live event stream connected' : 'Reconnecting to event stream'}
        </div>
        <div className="text-sm text-muted-foreground">Total events: {eventFabric.totalEvents}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5" />
            Recent Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {eventFabric.events.slice(0, 12).map((event) => (
                  <tr key={event.id} className="border-t">
                    <td className="px-3 py-2 font-mono">{event.type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{event.source ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</td>
                  </tr>
                ))}
                {eventFabric.events.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={3}>
                      No events received yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
