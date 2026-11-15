'use strict';

/**
 * Profit and risk estimates — conservative defaults, never invent revenue.
 */

function grossRevenueUsd(lead) {
  const b = lead.budget || {};
  if (!Number.isFinite(b.max) && !Number.isFinite(b.min)) return null;
  const top = Number.isFinite(b.max) ? b.max : b.min;
  if (b.type === 'hourly') return Number.isFinite(b.min) ? b.min * 10 : top * 10;
  return top;
}

function estimateEconomics(lead, config, { matchScore = 0, feasibility = 0.5 } = {}) {
  const gross = grossRevenueUsd(lead);
  const platformRate = Number(config.defaultPlatformFeeRate) || 0.1;
  const payRate = Number(config.paymentProcessingRate) || 0.029;
  const infra = Number(config.estimatedInfraCostUsd) || 5;
  const hourly = Number(config.defaultHourlyLaborCostUsd) || 45;
  const hours = feasibility >= 0.7 ? 8 : feasibility >= 0.4 ? 16 : 24;
  const labor = hours * hourly;
  const platformFee = gross != null ? gross * platformRate : null;
  const processing = gross != null ? gross * payRate : null;
  const totalCost = labor + infra + (platformFee || 0) + (processing || 0);
  const net = gross != null ? gross - totalCost : null;

  const bids = Number.isFinite(lead.bids) ? lead.bids : null;
  let competition = 50;
  if (bids != null) competition = Math.min(100, 20 + bids * 4);

  let clientRisk = 30;
  const desc = String(lead.description || '').toLowerCase();
  if (desc.includes('unpaid') || desc.includes('equity only')) clientRisk = 90;
  if (!lead.company) clientRisk += 10;

  const riskScore = Math.min(100, Math.round((competition + clientRisk) / 2));
  const profitOk = net != null && net >= (Number(config.minNetProfitUsd) || 50);

  return {
    grossRevenueUsd: gross,
    platformFeeUsd: platformFee,
    processingFeeUsd: processing,
    laborCostUsd: labor,
    infraCostUsd: infra,
    totalCostUsd: totalCost,
    netRevenueUsd: net,
    estimatedHours: hours,
    competitionScore: competition,
    clientRiskScore: clientRisk,
    riskScore,
    economicallyViable: profitOk,
    opportunityScore: Math.round((matchScore * 0.5) + (profitOk ? 25 : 0) + (100 - riskScore) * 0.25),
  };
}

module.exports = { grossRevenueUsd, estimateEconomics };