import revenue from '@repo/lib/dashboard/revenue-service';
import type { RevenueSummary } from '@/lib/dashboard/types';

export const REVENUE_STREAMS: string[] = revenue.REVENUE_STREAMS;

export async function fetchRevenueForProject(project: string): Promise<RevenueSummary | null> {
  const data = (await revenue.fetchRevenueForProject(project)) as RevenueSummary | null;
  return data;
}

export async function fetchClientDashboard(project: string): Promise<Record<string, unknown> | null> {
  return (await revenue.fetchClientDashboard(project)) as Record<string, unknown> | null;
}
