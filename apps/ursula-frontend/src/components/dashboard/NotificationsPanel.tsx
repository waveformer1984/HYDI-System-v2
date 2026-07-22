'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Bell, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

function levelIcon(level: string) {
  switch (level) {
    case 'critical':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'alert':
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

export function NotificationsPanel() {
  const { notifications, acknowledgeNotification, clearNotifications } = useDashboard();

  const unacknowledged = notifications.filter((n) => !n.acknowledged);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5" />
            Notifications
            {unacknowledged.length > 0 && (
              <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unacknowledged.length}</span>
            )}
          </CardTitle>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearNotifications}>
              Clear all
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[320px] overflow-y-auto">
          {notifications.slice(0, 20).map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between rounded-md border p-3 ${
                n.acknowledged ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                {levelIcon(n.level)}
                <div>
                  <div className="text-sm">{n.message}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {n.source} · {new Date(n.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
              {!n.acknowledged && (
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => acknowledgeNotification(n.id)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {notifications.length === 0 && <div className="text-muted-foreground">No notifications.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
