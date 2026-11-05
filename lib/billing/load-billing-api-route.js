'use strict';

/**
 * Load pages/api/billing/* handlers from plain Node (mobile-ops, scripts).
 * Next.js API routes are ESM; Jest transpiles them via babel-jest — replicate that here.
 */

const path = require('path');

let babelRegistered = false;

function ensureBabelRegister() {
  if (babelRegistered || process.env.JEST_WORKER_ID) return;
  // eslint-disable-next-line global-require
  require('@babel/register')({
    configFile: path.join(__dirname, '../../babel.jest.config.js'),
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    ignore: [/node_modules/],
  });
  babelRegistered = true;
}

/**
 * @param {string} routePath path under pages/api/billing, e.g. 'checkout' or 'webhook'
 * @returns {import('next').NextApiHandler}
 */
function loadBillingApiRoute(routePath) {
  ensureBabelRegister();
  const abs = path.join(__dirname, '../../pages/api/billing', routePath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mod = require(abs);
  return mod.default || mod;
}

module.exports = { loadBillingApiRoute, ensureBabelRegister };
