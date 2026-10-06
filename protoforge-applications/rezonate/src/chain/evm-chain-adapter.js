const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ARTIFACTS = path.join(__dirname, '..', '..', 'contracts', 'artifacts');
const DEPLOYMENTS_FILE = path.join(__dirname, '..', '..', 'contracts', 'deployments.json');

// Resolved lazily so REZONATE_DEPLOYMENTS_FILE can isolate deployment records
// per environment (e.g. a test chain must not overwrite the live record).
function deploymentsFile() { return process.env.REZONATE_DEPLOYMENTS_FILE || DEPLOYMENTS_FILE; }

const MODES = ['local', 'testnet', 'mainnet'];

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${name}.json`), 'utf8'));
}

function loadDeployments() {
  try { return JSON.parse(fs.readFileSync(deploymentsFile(), 'utf8')); } catch { return {}; }
}

function saveDeployment(key, value) {
  const all = loadDeployments();
  all[key] = value;
  fs.writeFileSync(deploymentsFile(), JSON.stringify(all, null, 2));
}

/**
 * Real EVM chain adapter. Everything here is actual JSON-RPC against an
 * actual EVM — mode only decides WHICH chain:
 *   local   — a real local EVM node (ganache); proving environment
 *   testnet — public testnet (Sepolia/Base Sepolia) via REZONATE_CHAIN_RPC
 *   mainnet — gated: refuses unless ALLOW_LIVE_CHAIN=true
 * For in-memory unit tests use MockChainAdapter — never this class.
 */
class EvmChainAdapter {
  constructor(options = {}) {
    this.mode = options.mode || 'local';
    if (!MODES.includes(this.mode)) throw new Error(`invalid chain mode '${this.mode}'`);
    if (this.mode === 'mainnet' && process.env.ALLOW_LIVE_CHAIN !== 'true') {
      throw new Error('mainnet refused: ALLOW_LIVE_CHAIN is not true');
    }
    this.rpcUrl = options.rpcUrl || process.env.REZONATE_CHAIN_RPC || null;
    this.deployerKey = options.deployerKey || process.env.REZONATE_DEPLOYER_KEY || null;
    this.walletKeys = options.walletKeys || {}; // address -> privateKey
    this.confirmations = options.confirmations || 1;
    this.feeBps = options.feeBps ?? 250;
    this._ganache = null;
    this.provider = null;
    this.nft = null;      // ethers.Contract (read via provider, write via signer)
    this.market = null;
    this.deploymentKey = null;
    this.isMock = false;
  }

  async init() {
    const port = Number(process.env.REZONATE_LOCAL_CHAIN_PORT || 8545);
    if (this.mode === 'local' && !this.rpcUrl) this.rpcUrl = `http://127.0.0.1:${port}`;
    if (!this.rpcUrl) throw new Error(`chain mode '${this.mode}' requires REZONATE_CHAIN_RPC`);
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    let network = null;
    try { network = await this.provider.getNetwork(); } catch { /* node not up yet */ }
    if (!network && this.mode === 'local') {
      // Real local EVM — not simulated state; a genuine JSON-RPC chain.
      // Attach to an already-running node if possible; spawn only when absent.
      // When an explicit rpcUrl was given, spawn on ITS port, not the env port.
      const ganache = require('ganache');
      const listenPort = this.rpcUrl ? Number(new URL(this.rpcUrl).port || port) : port;
      this._ganache = ganache.server({ chain: { chainId: 31337 }, wallet: { totalAccounts: 6, defaultBalance: 100 }, logging: { quiet: true } });
      await this._ganache.listen(listenPort);
      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
      network = await this.provider.getNetwork();
    }
    if (!network) throw new Error(`no EVM node reachable at ${this.rpcUrl}`);
    this.chainId = Number(network.chainId);
    this.deploymentKey = `${this.mode}:${this.chainId}`;
    await this._ensureDeployment();
    return this;
  }

  async _deployerSigner() {
    if (this.deployerKey) return new ethers.Wallet(this.deployerKey, this.provider);
    const accs = await this.provider.listAccounts(); // unlocked accounts (local/testnode)
    if (!accs.length) throw new Error('no deployer wallet: set REZONATE_DEPLOYER_KEY');
    return this.provider.getSigner(accs[0].address);
  }

  /** Resolve a signer for a wallet address: configured key, else unlocked node account. */
  async signerFor(address) {
    const key = this.walletKeys[address.toLowerCase()];
    if (key) return new ethers.Wallet(key, this.provider);
    const accs = await this.provider.listAccounts();
    const found = accs.find(a => a.address.toLowerCase() === address.toLowerCase());
    if (!found) throw new Error(`no signer available for wallet ${address} — configure a key`);
    return this.provider.getSigner(found.address);
  }

  async defaultWallet() {
    const s = await this._deployerSigner();
    return s.address;
  }

  async _ensureDeployment() {
    const existing = loadDeployments()[this.deploymentKey];
    if (existing) {
      // A recorded deployment is only valid if the contract is actually on
      // this chain — a fresh local chain means the record is stale.
      const code = await this.provider.getCode(existing.nft).catch(() => '0x');
      if (code && code !== '0x') {
        this.nft = new ethers.Contract(existing.nft, loadArtifact('RezonateNFT').abi, this.provider);
        this.market = new ethers.Contract(existing.market, loadArtifact('RezonateMarket').abi, this.provider);
        return existing;
      }
    }
    const signer = await this._deployerSigner();
    const nftArt = loadArtifact('RezonateNFT');
    const nft = await new ethers.ContractFactory(nftArt.abi, nftArt.bytecode, signer).deploy();
    const nftReceipt = await nft.deploymentTransaction().wait(this.confirmations);
    const feeRecipient = await signer.getAddress();
    const marketArt = loadArtifact('RezonateMarket');
    const market = await new ethers.ContractFactory(marketArt.abi, marketArt.bytecode, signer)
      .deploy(this.feeBps, feeRecipient);
    const marketReceipt = await market.deploymentTransaction().wait(this.confirmations);
    const dep = {
      nft: await nft.getAddress(), market: await market.getAddress(),
      deployer: feeRecipient, feeBps: this.feeBps,
      nftDeployTx: nft.deploymentTransaction().hash, nftDeployBlock: nftReceipt.blockNumber,
      marketDeployTx: market.deploymentTransaction().hash, marketDeployBlock: marketReceipt.blockNumber,
      artifactVersion: this._artifactDigest(nftArt, marketArt),
      deployedAt: new Date().toISOString(), mode: this.mode, chainId: this.chainId
    };
    saveDeployment(this.deploymentKey, dep);
    this.nft = new ethers.Contract(dep.nft, nftArt.abi, this.provider);
    this.market = new ethers.Contract(dep.market, marketArt.abi, this.provider);
    return dep;
  }

  /** Public block explorer for the connected chain; null when none exists (local/mock). */
  explorerBase() {
    const EXPLORERS = {
      1: 'https://etherscan.io',
      11155111: 'https://sepolia.etherscan.io',
      8453: 'https://basescan.org',
      84532: 'https://sepolia.basescan.org',
      137: 'https://polygonscan.com',
      80002: 'https://amoy.polygonscan.com',
    };
    if (this.mode === 'local') return null;
    return EXPLORERS[this.chainId] || null;
  }

  _artifactDigest(...arts) {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256');
    for (const a of arts) h.update(a.bytecode);
    return h.digest('hex').slice(0, 16);
  }

  contractAddresses() {
    const dep = loadDeployments()[this.deploymentKey] || {};
    return { nft: dep.nft || null, market: dep.market || null, mode: this.mode, chainId: this.chainId, explorer: this.explorerBase() };
  }

  /** Full deployment record incl. deploy txs/blocks — evidence, never claimed without verifyDeployment(). */
  deploymentRecord() {
    const dep = loadDeployments()[this.deploymentKey] || null;
    return dep ? { ...dep, explorer: this.explorerBase() } : null;
  }

  /**
   * Independent verification: bytecode must actually exist at the recorded
   * addresses and contract state must match the recorded configuration.
   * A deployments.json entry alone is never treated as proof.
   */
  async verifyDeployment() {
    const dep = loadDeployments()[this.deploymentKey];
    if (!dep) return { verified: false, reason: 'no deployment recorded for this chain' };
    const checks = {};
    const codeAt = async (a) => this.provider.getCode(a).catch(() => '0x');
    checks.nftBytecode = (await codeAt(dep.nft)) !== '0x';
    checks.marketBytecode = (await codeAt(dep.market)) !== '0x';
    const nftRead = new ethers.Contract(dep.nft, loadArtifact('RezonateNFT').abi, this.provider);
    const marketRead = new ethers.Contract(dep.market, loadArtifact('RezonateMarket').abi, this.provider);
    checks.nftOwner = (await nftRead.owner().catch(() => null)) === dep.deployer;
    checks.marketFeeBps = Number(await marketRead.platformFeeBps().catch(() => -1)) === dep.feeBps;
    checks.marketFeeRecipient = (await marketRead.feeRecipient().catch(() => null)) === dep.deployer;
    checks.chainId = Number((await this.provider.getNetwork()).chainId) === dep.chainId;
    return { verified: Object.values(checks).every(Boolean), checks, deployment: { ...dep, explorer: this.explorerBase() } };
  }

  explorerTx(txHash) { const b = this.explorerBase(); return b && txHash ? `${b}/tx/${txHash}` : null; }
  explorerAddress(addr) { const b = this.explorerBase(); return b && addr ? `${b}/address/${addr}` : null; }
  explorerToken(tokenId) {
    const b = this.explorerBase(); const dep = loadDeployments()[this.deploymentKey] || {};
    return b && dep.nft && tokenId != null ? `${b}/nft/${dep.nft}/${tokenId}` : null;
  }

  async mintToken({ to, tokenUri, contentHash }) {
    const signer = await this._deployerSigner(); // contract owner
    const hash = ethers.zeroPadValue(contentHash.startsWith('0x') ? contentHash : '0x' + contentHash, 32);
    const tx = await this.nft.connect(signer).mint(to, tokenUri, hash);
    const receipt = await tx.wait(this.confirmations);
    if (!receipt || receipt.status !== 1) throw new Error(`mint transaction failed: ${tx.hash}`);
    const ev = receipt.logs.map(l => { try { return this.nft.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === 'Minted');
    if (!ev) throw new Error('mint receipt missing Minted event');
    return { tokenId: Number(ev.args.tokenId), txHash: tx.hash, blockNumber: receipt.blockNumber };
  }

  async ownerOf(tokenId) { return this.nft.ownerOf(tokenId); }
  async tokenURI(tokenId) { return this.nft.tokenURI(tokenId); }
  async contentHashTaken(contentHash) {
    const hash = ethers.zeroPadValue(contentHash.startsWith('0x') ? contentHash : '0x' + contentHash, 32);
    return Number(await this.nft.tokenByContentHash(hash)) || 0;
  }

  async listToken({ tokenId, priceWei, seller }) {
    const signer = await this.signerFor(seller);
    const nftAddr = await this.nft.getAddress();
    const marketAddr = await this.market.getAddress();
    const approveTx = await this.nft.connect(signer).approve(marketAddr, tokenId);
    await approveTx.wait(this.confirmations);
    const tx = await this.market.connect(signer).list(nftAddr, tokenId, priceWei);
    const receipt = await tx.wait(this.confirmations);
    if (!receipt || receipt.status !== 1) throw new Error(`list transaction failed: ${tx.hash}`);
    const ev = receipt.logs.map(l => { try { return this.market.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === 'Listed');
    if (!ev) throw new Error('list receipt missing Listed event');
    return { listingId: Number(ev.args.listingId), txHash: tx.hash, blockNumber: receipt.blockNumber };
  }

  async buyListing({ listingId, buyer }) {
    const signer = await this.signerFor(buyer);
    const l = await this.market.listings(listingId);
    if (!l.active) throw new Error(`listing ${listingId} is not active on-chain`);
    const tx = await this.market.connect(signer).buy(listingId, { value: l.price });
    const receipt = await tx.wait(this.confirmations);
    if (!receipt || receipt.status !== 1) throw new Error(`buy transaction failed: ${tx.hash}`);
    const ev = receipt.logs.map(lg => { try { return this.market.interface.parseLog(lg); } catch { return null; } })
      .find(e => e && e.name === 'Sold');
    return { txHash: tx.hash, blockNumber: receipt.blockNumber, fee: ev ? ev.args.fee.toString() : null };
  }

  async cancelListing({ listingId, seller }) {
    const signer = await this.signerFor(seller);
    const tx = await this.market.connect(signer).cancel(listingId);
    const receipt = await tx.wait(this.confirmations);
    if (!receipt || receipt.status !== 1) throw new Error(`cancel transaction failed: ${tx.hash}`);
    return { txHash: tx.hash };
  }

  async getListing(listingId) {
    const l = await this.market.listings(listingId);
    return { seller: l.seller, nft: l.nft, tokenId: Number(l.tokenId), price: l.price.toString(), active: l.active };
  }

  async getTxReceipt(txHash) { return this.provider.getTransactionReceipt(txHash); }
  async blockNumber() { return this.provider.getBlockNumber(); }

  async close() { if (this._ganache) await this._ganache.close(); }
}

module.exports = { EvmChainAdapter, MODES };
