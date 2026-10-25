const { createProvisionCodeHandler } = require('../../../../lib/phone/provision-routes.js');

const handler = createProvisionCodeHandler();

export default function provisionCode(req, res) {
  return handler(req, res);
}
