'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Settings, Radio, TestTube2 } from 'lucide-react';

export function SettingsPanel() {
  const { mode, toggleMode, connected } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings className="h-5 w-5" />
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2">
              {mode === 'live' ? <Radio className="h-4 w-4 text-green-500" /> : <TestTube2 className="h-4 w-4 text-blue-500" />}
              <div>
                <div className="font-medium">{mode === 'live' ? 'Live Mode' : 'Test Mode'}</div>
                <div className="text-sm text-muted-foreground">
                  {mode === 'live' ? 'Real endpoints and data' : 'Mock data for development'}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={toggleMode}>
              Switch to {mode === 'live' ? 'Test' : 'Live'}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">Event Stream</div>
              <div className="text-sm text-muted-foreground">Connection to the Event Fabric</div>
            </div>
            <div className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
