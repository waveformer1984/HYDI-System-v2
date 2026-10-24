#!/usr/bin/env node
'use strict';

const { buildLeadPack } = require('./lib/pack');

function parseArgs(argv) {
  const out = { radius: 25, count: 50, outreach: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--outreach') out.outreach = true;
    else if (['--niche', '--city', '--radius', '--count'].includes(arg)) {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  out.radius = Number(out.radius);
  out.count = Number(out.count);
  return out;
}

async function main() {
  try {
    const request = parseArgs(process.argv.slice(2));
    const pack = await buildLeadPack(request);
    console.log(`Lead pack ${pack.id} ready: ${pack.leads.length} leads`);
    console.log(`CSV: ${pack.csvPath}`);
    console.log(`PDF: ${pack.pdfPath}`);
    if (pack.sourceErrors.length) console.warn(`Source warnings: ${pack.sourceErrors.join('; ')}`);
  } catch (error) {
    console.error(`Lead Forge failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
