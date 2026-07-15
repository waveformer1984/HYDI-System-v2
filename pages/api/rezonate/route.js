// See pages/api/health.js for why this bridge exists. rezonate/route.js is
// CommonJS (module.exports = handler), but Next.js's pages/api loader
// specifically looks for a `default` export, so re-export under both keys.
const handler = require('../../../api/rezonate/route.js');
module.exports = handler;
module.exports.default = handler;
