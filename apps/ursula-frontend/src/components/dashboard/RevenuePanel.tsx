'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Coins, DollarSign, Wallet } from 'lucide-react';

export function RevenuePanel() {
  const { revenue } = useDashboard();

  return (
    <div className="space-y-4">
      {revenue.map((stream) => (
        <Card key={stream.revenueStream}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg capitalize">
              <Coins className="h-5 w-5" />
              {stream.revenueStream.replace(/_/g, ' ')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">Gross</div>
                <div className="text-xl font-semibold">${stream.gross.toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">Net</div>
                <div className="text-xl font-semibold">${stream.net.toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Wallet className="h-3 w-3" /> Available
                </div>
                <div className="text-xl font-semibold">${stream.availableForPayout.toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <DollarSign className="h-3 w-3" /> Pending
                </div>
                <div className="text-xl font-semibold">${stream.pendingPayout.toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {revenue.length === 0 && (
        <Card>
          <CardContent className="p-6 text-muted-foreground">No revenue data available.</CardContent>
        </Card>
      )}
    </div>
  );
}
