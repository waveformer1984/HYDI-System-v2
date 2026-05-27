import React from 'react';

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

interface PipelineRowProps {
  label: string;
  total: number;
  expected: number;
  pct: number;
  barColor: string;
  bgColor: string;
}

function PipelineRow({ label, total, expected, pct, barColor, bgColor }: PipelineRowProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="text-right">
          <span className="text-sm font-bold text-gray-900">{formatCurrency(total)}</span>
          <span className="text-xs text-gray-500 ml-1">total</span>
        </div>
      </div>
      <div className={`h-4 ${bgColor} rounded-full overflow-hidden`}>
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-500">{formatCurrency(expected)} expected ({pct}%)</span>
      </div>
    </div>
  );
}

export default function PipelineSection() {
  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Pipeline Visualization</h2>

      <PipelineRow
        label="Grants"
        total={8700000}
        expected={6090000}
        pct={70}
        barColor="bg-blue-500"
        bgColor="bg-blue-100"
      />
      <PipelineRow
        label="Corporate"
        total={3000000}
        expected={1500000}
        pct={50}
        barColor="bg-purple-500"
        bgColor="bg-purple-100"
      />
      <PipelineRow
        label="Revenue (Annual)"
        total={1500000}
        expected={450000}
        pct={30}
        barColor="bg-green-500"
        bgColor="bg-green-100"
      />

      <div className="mt-4 pt-3 border-t">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Total Pipeline</span>
          <span className="font-bold text-gray-800">$11.7M</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>Total Expected</span>
          <span className="font-bold text-green-700">$7.59M</span>
        </div>
      </div>
    </div>
  );
}
