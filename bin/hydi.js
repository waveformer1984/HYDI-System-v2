#!/usr/bin/env node
'use strict';

const { Kernel, DoctorCLI } = require('../src/hydi-v4');

async function main() {
  const kernel = new Kernel({ autoStartModules: false });
  const cli = new DoctorCLI(kernel);
  try {
    const result = await cli.run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result && result.ok === false ? 1 : 0);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  } finally {
    await kernel.stop();
  }
}

main();
