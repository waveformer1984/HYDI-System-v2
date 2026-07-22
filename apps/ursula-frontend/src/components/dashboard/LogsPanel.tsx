'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Terminal } from 'lucide-react';

export function LogsPanel() {
  const { logs } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Terminal className="h-5 w-5" />
          Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[240px] overflow-y-auto rounded-md border bg-black p-3 font-mono text-xs text-green-400">
          {logs.length === 0 && <div className="text-gray-500">No log lines received.</div>}
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
