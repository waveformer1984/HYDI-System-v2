import { useState, useCallback } from 'react';
import type { Campaign } from '../lib/zlabs/types';
import {
  getAllCampaigns,
  getUrgentCampaigns,
  getPipelineStats,
  daysUntil,
} from '../lib/zlabs/data';
import CampaignCard from '../components/funding/CampaignCard';
import PipelineSection from '../components/funding/PipelineSection';
import HydiChat from '../components/funding/HydiChat';

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

type SortKey = 'name' | 'amount' | 'deadline' | 'category' | 'status' | 'days';
type SortDir = 'asc' | 'desc';

const STATUS_LABELS: Record<Campaign['status'], string> = {
  ready: 'Ready',
  in_progress: 'In Progress',
  planned: 'Planned',
  partnerships_needed: 'Partnerships Needed',
  submitted: 'Submitted',
};

const STATUS_COLORS: Record<Campaign['status'], string> = {
  ready: 'bg-green-100 text-green-800',
  in_progress: 'bg-blue-100 text-blue-800',
  planned: 'bg-gray-100 text-gray-700',
  partnerships_needed: 'bg-orange-100 text-orange-800',
  submitted: 'bg-purple-100 text-purple-800',
};

interface StatCardProps {
  label: string;
  primary: string;
  secondary?: string;
}

function StatCard({ label, primary, secondary }: StatCardProps) {
  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{primary}</p>
      {secondary && <p className="text-xs text-gray-500 mt-0.5">{secondary}</p>}
    </div>
  );
}

export default function FundingPage() {
  const campaigns = getAllCampaigns();
  const urgentCampaigns = getUrgentCampaigns();
  const stats = getPipelineStats();

  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [hydiPrompt, setHydiPrompt] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'amount':
        cmp = a.amount - b.amount;
        break;
      case 'deadline':
        cmp = a.deadline.localeCompare(b.deadline);
        break;
      case 'category':
        cmp = a.category.localeCompare(b.category);
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'days':
        cmp = daysUntil(a.deadline) - daysUntil(b.deadline);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleAskHydi = useCallback((prompt: string) => {
    setHydiPrompt(prompt);
  }, []);

  const handlePromptConsumed = useCallback(() => {
    setHydiPrompt(null);
  }, []);

  const SortHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none"
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col && (
        <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">
              Z-LABS FUNDING COMMAND CENTER
            </h1>
            <p className="text-xs text-gray-500">Pipeline Management Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700 font-medium">Jordan A.</span>
            <a
              href="/"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              Heidi →
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Pipeline"
            primary={formatCurrency(stats.totalPipeline)}
          />
          <StatCard
            label="Grants Pipeline"
            primary={formatCurrency(stats.totalGrants)}
            secondary={`${formatCurrency(stats.expectedGrants)} expected`}
          />
          <StatCard
            label="Corporate Pipeline"
            primary={formatCurrency(stats.totalCorporate)}
            secondary={`${formatCurrency(stats.expectedCorporate)} expected`}
          />
          <StatCard
            label="Revenue Target"
            primary={formatCurrency(stats.annualRevenue)}
            secondary={`${formatCurrency(stats.revenueContracted)} contracted`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                Urgent Actions ({urgentCampaigns.length})
              </h2>
              {urgentCampaigns.length === 0 ? (
                <div className="bg-white border rounded-lg shadow-sm p-6 text-center text-gray-400 text-sm">
                  No urgent campaigns at this time.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {urgentCampaigns.map((campaign) => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      onAskHydi={handleAskHydi}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                All Campaigns ({campaigns.length})
              </h2>
              <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <SortHeader label="Campaign" col="name" />
                        <SortHeader label="Amount" col="amount" />
                        <SortHeader label="Deadline" col="deadline" />
                        <SortHeader label="Category" col="category" />
                        <SortHeader label="Status" col="status" />
                        <SortHeader label="Days Left" col="days" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedCampaigns.map((campaign) => {
                        const days = daysUntil(campaign.deadline);
                        const rowBg =
                          days < 7
                            ? 'bg-red-50'
                            : days < 14
                            ? 'bg-amber-50'
                            : 'bg-white';

                        return (
                          <tr key={campaign.id} className={`${rowBg} hover:bg-gray-50 transition-colors`}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{campaign.name}</div>
                              <div className="text-xs text-gray-500">{campaign.funder}</div>
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {formatCurrency(campaign.amount)}
                            </td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                              {campaign.deadline}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                                  campaign.category === 'grant'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-purple-50 text-purple-700'
                                }`}
                              >
                                {campaign.category}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[campaign.status]}`}
                              >
                                {STATUS_LABELS[campaign.status]}
                              </span>
                            </td>
                            <td
                              className={`px-3 py-2 font-medium whitespace-nowrap ${
                                days < 7
                                  ? 'text-red-600'
                                  : days < 14
                                  ? 'text-amber-600'
                                  : 'text-gray-600'
                              }`}
                            >
                              {days}d
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <PipelineSection />
            <HydiChat
              campaigns={campaigns}
              stats={stats}
              initialPrompt={hydiPrompt}
              onPromptConsumed={handlePromptConsumed}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
