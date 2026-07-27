'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, CheckCircle } from 'lucide-react';

export function ProtoForgePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          ProtoForge Governance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Policy engine is fail-closed
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-500" />
            KILO hypotheses are never auto-executed
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Six-layer pipeline enforced
          </div>
          <div className="text-xs text-muted-foreground mt-4">
            Detailed governance metrics will stream from the Event Fabric once policy events are wired.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
