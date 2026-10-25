const { createPhoneObserveHandler } = require('../../../lib/observation/phone-observe-route.js');

const handler = createPhoneObserveHandler();

export default function observe(req, res) {
  return handler(req, res);
}
