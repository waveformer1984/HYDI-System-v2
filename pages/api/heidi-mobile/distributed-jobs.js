// Mobile BFF — durable distributed-cloud job state (file-backed control plane on host).
// Survives home-PC worker outage when the host serving this route is up (e.g. cloud agent VM, Pages shell + API URL).

const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { mobileSnapshot } = require('../../../lib/heidi-mobile/distributed-cloud-snapshot.js');

module.exports = async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'distributed-jobs', rateMax: 60 });
  if (!g.ok) return;

  const snap = mobileSnapshot();
  return res.status(200).json(snap);
};