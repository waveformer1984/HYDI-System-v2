const { createPhoneRevenueHandler } = require('../../../lib/billing/phone-revenue-route.js');

const handler = createPhoneRevenueHandler();

export default function revenueSummary(req, res) {
  return handler(req, res);
}
