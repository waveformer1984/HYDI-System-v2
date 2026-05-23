/**
 * deploy-agent-registry.js
 *
 * Deploys HydiAgentRegistry to the target network and writes the deployed
 * contract address back to .env.local so hydi-processor can load it
 * without manual copy-paste.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-agent-registry.js --network localhost
 *   npx hardhat run scripts/deploy-agent-registry.js --network holesky
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  console.log(`\n[HydiAgentRegistry] Deploying to network: ${network}`);
  console.log(`[HydiAgentRegistry] Deployer (substrate orchestrator): ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[HydiAgentRegistry] Deployer balance: ${ethers.formatEther(balance)} ETH`);

  // Deploy
  const Factory = await ethers.getContractFactory('HydiAgentRegistry');
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  console.log(`\n[HydiAgentRegistry] ✅ Deployed at: ${contractAddress}`);
  console.log(`[HydiAgentRegistry]    substrateOrchestrator: ${await registry.substrateOrchestrator()}`);

  // Persist address to .env.local so hydi-processor can pick it up
  const envPath = path.join(__dirname, '..', '.env.local');
  const envKey  = `HYDI_AGENT_REGISTRY_${network.toUpperCase()}`;
  const envLine = `\n${envKey}=${contractAddress}\n`;

  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, 'utf8');
    // Replace existing key if present, otherwise append
    if (existing.includes(envKey)) {
      const updated = existing.replace(new RegExp(`${envKey}=.*`), `${envKey}=${contractAddress}`);
      fs.writeFileSync(envPath, updated, 'utf8');
    } else {
      fs.appendFileSync(envPath, envLine, 'utf8');
    }
  } else {
    fs.writeFileSync(envPath, envLine.trimStart(), 'utf8');
  }

  console.log(`[HydiAgentRegistry]    ${envKey} written to .env.local`);

  // Quick smoke-test: log one synthetic record to confirm the contract works
  const testCorrelationId = `test-deploy-${Date.now()}`;
  const testHash = ethers.keccak256(ethers.toUtf8Bytes('HYDI_GENESIS_INVARIANT_PASS'));
  const tx = await registry.logExecution(testCorrelationId, testHash, true);
  await tx.wait();
  console.log(`[HydiAgentRegistry]    Smoke-test record logged: ${testCorrelationId}`);

  const [h, ts, passed] = await registry.verifyRecord(testCorrelationId);
  console.log(`[HydiAgentRegistry]    Verified → hash=${h} ts=${ts} invariantPassed=${passed}`);
  console.log(`\n[HydiAgentRegistry] Deployment complete.\n`);
}

main().catch((err) => {
  console.error('[HydiAgentRegistry] Deploy failed:', err);
  process.exitCode = 1;
});
