#!/usr/bin/env node
/**
 * Compile the Rezonate NFT + Market contracts with solc → contracts/artifacts/*.json
 * Artifacts are committed so runtime never needs solc.
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const OUT = path.join(CONTRACTS, 'artifacts');

function findImports(importPath) {
  const candidates = [
    path.join(CONTRACTS, importPath),
    path.join(ROOT, 'node_modules', importPath)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { contents: fs.readFileSync(c, 'utf8') };
  }
  return { error: `Import not found: ${importPath}` };
}

const sources = {};
for (const name of ['RezonateNFT.sol', 'RezonateMarket.sol']) {
  sources[name] = { content: fs.readFileSync(path.join(CONTRACTS, name), 'utf8') };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'paris', // pre-PUSH0 target — compatible with ganache local chains
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  const fatal = output.errors.filter(e => e.severity === 'error');
  for (const e of output.errors) console.error(e.formattedMessage);
  if (fatal.length) process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    const artifact = { contractName: name, sourceName: file, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(artifact, null, 2));
    console.log(`compiled ${name} -> contracts/artifacts/${name}.json`);
  }
}
