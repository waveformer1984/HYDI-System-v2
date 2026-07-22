'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { Activity, Cpu, HardDrive, Thermometer, Clock, Server } from 'lucide-react';

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  status,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
}) {
  const statusClass =
    status === 'ok'
      ? 'text-green-600'
      : status === 'warning'
        ? 'text-yellow-600'
        : status === 'critical'
          ? 'text-red-600'
          : 'text-gray-500';

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${statusClass}`} />
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold">
              {value}
              {unit ? <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span> : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SystemHealthPanel() {
  const { systemHealth } = useDashboard();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard icon={Cpu} label="CPU" value={systemHealth.cpu.value} unit={systemHealth.cpu.unit} status={systemHealth.cpu.status} />
        <MetricCard icon={Activity} label="Memory" value={systemHealth.memory.value} unit={systemHealth.memory.unit} status={systemHealth.memory.status} />
        <MetricCard icon={HardDrive} label="Disk" value={systemHealth.disk.value} unit={systemHealth.disk.unit} status={systemHealth.disk.status} />
        <MetricCard icon={Clock} label="Uptime" value={systemHealth.uptime.value} status={systemHealth.uptime.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Server className="h-5 w-5" />
            Service Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {systemHealth.services.map((service) => (
              <div
                key={service.name}
                className={`flex items-center justify-between rounded-md border p-3 ${
                  service.healthy ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}
              >
                <div>
                  <div className="font-medium">{service.name}</div>
                  <div className="text-sm text-muted-foreground">{service.status}</div>
                </div>
                <div className={`h-3 w-3 rounded-full ${service.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {systemHealth.temperatures && systemHealth.temperatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Thermometer className="h-5 w-5" />
              Temperatures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {systemHealth.temperatures.map((t) => (
                <div key={t.name} className="rounded-md border p-3">
                  <div className="text-sm text-muted-foreground">{t.name}</div>
                  <div className="text-xl font-semibold">
                    {t.value}
                    {t.unit}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
