'use strict';

/**
 * Mission opportunity catalog — scores are HYPOTHESIS unless evidence field says FACT.
 * Used for ranking only; not live market data.
 */

const PRODUCT_CATALOG = Object.freeze([
  {
    id: 'detailer_bot_sa',
    name: 'San Antonio Detailer Bot (booking + follow-up)',
    selected: true,
    criteria: {
      timeToFirstPayment: 78,
      verifiedDemand: 55,
      profitPotential: 70,
      startupCost: 85,
      deliveryAutomation: 75,
      recurringRevenue: 60,
    },
    targetCustomer: 'Independent mobile detailers and small auto appearance shops (San Antonio metro)',
    problem: 'Missed calls, manual booking, inconsistent follow-up',
    evidenceNote: 'HYPOTHESIS — validate with 10 owner interviews; repo has detailer_bot stream wiring',
  },
  {
    id: 'smb_automation',
    name: 'AI-powered small-business automation (inbox + tasks)',
    criteria: {
      timeToFirstPayment: 50,
      verifiedDemand: 60,
      profitPotential: 65,
      startupCost: 70,
      deliveryAutomation: 50,
      recurringRevenue: 55,
    },
    targetCustomer: '1–10 person service businesses already on Gmail/Sheets',
    problem: 'Owner time sunk in repetitive admin',
    evidenceNote: 'HYPOTHESIS — crowded market; HYDI has orchestration + fabric',
  },
  {
    id: 'web_booking_automation',
    name: 'Website + booking automation (Next.js + Stripe)',
    criteria: {
      timeToFirstPayment: 72,
      verifiedDemand: 70,
      profitPotential: 68,
      startupCost: 75,
      deliveryAutomation: 65,
      recurringRevenue: 40,
    },
    targetCustomer: 'Local service businesses without online booking',
    problem: 'No-shows and phone tag',
    evidenceNote: 'FACT (repo): Next.js + Stripe Connect tests exist; demand per customer TBD',
  },
  {
    id: 'lipi_lead_packs',
    name: 'LiPi v2 lead packs (curated B2B lists)',
    criteria: {
      timeToFirstPayment: 60,
      verifiedDemand: 45,
      profitPotential: 55,
      startupCost: 80,
      deliveryAutomation: 70,
      recurringRevenue: 35,
    },
    targetCustomer: 'Solo consultants needing curated niche leads',
    problem: 'Low-quality purchased lists',
    evidenceNote: 'HYPOTHESIS — lipi_v2 stream configured; no verified paid LiPi sales in audit',
  },
  {
    id: 'galactic_bytes',
    name: 'Galactic Bytes (digital product / template packs)',
    criteria: {
      timeToFirstPayment: 40,
      verifiedDemand: 35,
      profitPotential: 50,
      startupCost: 90,
      deliveryAutomation: 80,
      recurringRevenue: 30,
    },
    targetCustomer: 'Indie creators needing asset bundles',
    problem: 'Fragmented toolchain',
    evidenceNote: 'HYPOTHESIS — stream exists; product-market fit unverified',
  },
  {
    id: 'heidi_ops_retainer',
    name: 'Heidi ops retainer (health + mobile approvals for local SMB)',
    criteria: {
      timeToFirstPayment: 65,
      verifiedDemand: 50,
      profitPotential: 72,
      startupCost: 88,
      deliveryAutomation: 60,
      recurringRevenue: 85,
    },
    targetCustomer: 'Technical owner-operators with one Windows “Frank” host',
    problem: 'No visibility when systems degrade',
    evidenceNote: 'FACT (repo): mobile status + frank-observer; paying customer TBD',
  },
]);

module.exports = { PRODUCT_CATALOG };