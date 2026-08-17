import React from 'react';
import { Campaign } from '../../lib/zlabs/types';
import { daysUntil } from '../../lib/zlabs/data';

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

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

const BORDER_COLORS: Record<Campaign['priority'], string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-amber-500',
  medium: 'border-l-blue-400',
  low: 'border-l-gray-300',
};

interface CampaignCardProps {
  campaign: Campaign;
  onAskHydi: (_prompt: string) => void;
}

export default function CampaignCard({ campaign, onAskHydi }: CampaignCardProps) {
  const days = daysUntil(campaign.deadline);

  return (
    <div className={`bg-white border border-l-4 ${BORDER_COLORS[campaign.priority]} rounded-lg shadow-sm p-4`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
          <p className="text-sm text-gray-500">{campaign.funder}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-gray-900">{formatCurrency(campaign.amount)}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[campaign.status]}`}>
            {STATUS_LABELS[campaign.status]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-medium ${days <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
          {days} days left
        </span>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs text-gray-500">Due {campaign.deadline}</span>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs text-gray-500">{campaign.probability}% probability</span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{campaign.completionPct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${campaign.completionPct}%` }}
          />
        </div>
      </div>

      {campaign.missingItems && campaign.missingItems.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-red-600 mb-1">Missing Items:</p>
          <ul className="space-y-0.5">
            {campaign.missingItems.map((item, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                <span className="text-red-400 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          className="flex-1 text-xs px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={() => {}}
        >
          View Details
        </button>
        <button
          className="flex-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          onClick={() => onAskHydi(`Tell me about the ${campaign.name} campaign and what I need to do next.`)}
        >
          Ask Hydi
        </button>
      </div>
    </div>
  );
}
