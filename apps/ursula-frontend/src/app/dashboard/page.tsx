'use client';

import { DashboardProvider } from '@/lib/dashboard/dashboard-context';
import OperatorDashboard from '@/components/ui/operator-dashboard';

export default function DashboardPage() {
  return (
    <DashboardProvider>
      <OperatorDashboard />
    </DashboardProvider>
  );
}
