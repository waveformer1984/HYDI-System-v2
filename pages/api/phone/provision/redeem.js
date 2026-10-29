const { createProvisionRedeemHandler } = require('../../../../lib/phone/provision-routes.js');

const handler = createProvisionRedeemHandler();

export default function provisionRedeem(req, res) {
  return handler(req, res);
}
