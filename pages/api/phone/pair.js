const { createPhonePairHandler } = require('../../../lib/billing/phone-pair-route.js');

const handler = createPhonePairHandler();

export default function pairPhone(req, res) {
  return handler(req, res);
}
