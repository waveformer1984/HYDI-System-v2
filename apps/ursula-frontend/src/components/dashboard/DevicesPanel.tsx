'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Smartphone, RefreshCw } from 'lucide-react';

type PendingDevice = {
  device_id: string;
  device_name: string | null;
  role: string;
  status: string;
  created_at: string;
};

export function DevicesPanel() {
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/devices');
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPending(data.pending || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load failed');
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (deviceId: string, action: 'approve' | 'reject') => {
    setBusyId(deviceId);
    setError(null);
    try {
      const r = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ursula-request': '1' },
        body: JSON.stringify({ action }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Smartphone className="h-5 w-5" />
          Heidi Mobile — pending devices
        </CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refresh devices">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Approve phones for operator access without using Frank&apos;s shell. Pair on the phone first; pending rows appear here.
        </p>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {loading && pending.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && pending.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No devices waiting for approval.</p>
        )}
        {pending.map((d) => (
          <div key={d.device_id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium font-mono text-sm">{d.device_id}</div>
              <div className="text-sm text-muted-foreground">
                {d.device_name || 'Unnamed device'} · requested {d.role} · {new Date(d.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busyId === d.device_id}
                onClick={() => act(d.device_id, 'approve')}
              >
                Approve (operator)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busyId === d.device_id}
                onClick={() => act(d.device_id, 'reject')}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
