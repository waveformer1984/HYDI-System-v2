const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const { sha256File, sha256Json, buildNftMetadata } = require('./metadata');
const { ValidationError, NotFoundError } = require('../errors');

const NFT_STATES = ['draft', 'prepared', 'minting', 'minted', 'mint_failed'];
const LISTING_STATES = ['listed', 'cancelled', 'closed'];
const SALE_STATES = ['purchase_pending', 'sale_submitted', 'sale_confirmed', 'reconciled', 'sale_failed'];

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }

/**
 * NftService — orchestrates the honest mint→list→buy pipeline.
 * Invariants:
 *  - DB never claims minted/listed/sold without a confirmed chain receipt.
 *  - Ownership answers always come from the chain, never the cache.
 *  - chain_mode (mock|local|testnet|mainnet) is stamped on every record.
 */
class NftService {
  constructor({ repository, chain, baseUrl, mintToken = null, logger }) {
    this.repo = repository;
    this.chain = chain;
    this.baseUrl = (baseUrl || 'http://localhost:3001').replace(/\/$/, '');
    this.mintToken = mintToken; // optional shared-secret gate for mint calls
    this.logger = logger || { info: () => { }, warn: () => { } };
  }

  _emit(type, payload) { if (this.repo.eventBus) this.repo.eventBus.emit(type, payload); }
  _table(t) { return this.repo.store; }
  _get(t, iid) { return this._table(t).getById(t, iid); }
  _all(t) { return this._table(t).getAll(t); }
  _put(t, r) { this._table(t).create(t, r); }
  _update(t, r) { this._table(t).update(t, r.id, r); }

  _requireWallet(address, field = 'wallet') {
    if (!address || !ethers.isAddress(address)) throw new ValidationError(`${field} is not a valid EVM address`);
    return ethers.getAddress(address); // checksummed
  }

  _checkMintAuth(headers = {}) {
    if (this.mintToken && headers['x-mint-token'] !== this.mintToken) {
      throw new ValidationError('mint authorization failed');
    }
  }

  /** PHASE 2/3 — register an NFT asset around an existing Rezonate audio asset. */
  createNftAsset({ sourceAssetId, creatorWallet, title, description, artworkUri = null, audio = {} }) {
    const asset = this.repo.getAsset(sourceAssetId); // throws if missing
    const wallet = this._requireWallet(creatorWallet, 'creatorWallet');
    const filePath = asset.file_path;
    if (!filePath || !fs.existsSync(filePath)) throw new ValidationError('source asset file is not on disk');
    const contentHash = sha256File(filePath);

    // duplicate NFT asset for the same content is refused — mint dupes are impossible
    const dupe = this._all('nft_assets').find(n => n.content_hash === contentHash);
    if (dupe) throw new ValidationError(`an NFT asset already exists for this content (${dupe.id})`);

    const nftAsset = {
      id: id(), creator_id: wallet, source_asset_id: asset.id,
      content_hash: contentHash, title: title || asset.name || 'Rezonate Asset',
      description: description || '', artwork_uri: artworkUri,
      audio: { ...audio, engine_version: audio.engine_version || null },
      status: 'draft', chain_mode: this.chain.mode, created_at: now(), updated_at: now()
    };

    // provenance: link the audio asset's manifest if it has one (e.g. segment-swap)
    const manifestPath = asset.metadata?.manifest;
    if (manifestPath && fs.existsSync(manifestPath)) {
      nftAsset.provenance_manifest = manifestPath;
      nftAsset.provenance_manifest_hash = sha256File(manifestPath);
    }

    const meta = buildNftMetadata({ nftAsset, asset, baseUrl: this.baseUrl });
    nftAsset.metadata_hash = sha256Json(meta);
    nftAsset.metadata_uri = `${this.baseUrl}/nft/assets/${nftAsset.id}/metadata.json`;
    nftAsset.media_uri = `${this.baseUrl}/assets/${asset.id}/file`;
    nftAsset.status = 'prepared';
    this._put('nft_assets', nftAsset);
    this._emit('nft.asset.prepared', { nftAsset });
    return nftAsset;
  }

  /** Deterministic ERC-721 metadata document — this is what tokenURI serves. */
  getMetadata(nftId) {
    const nft = this._get('nft_assets', nftId);
    if (!nft) throw new NotFoundError('NFT asset not found');
    const asset = this.repo.getAsset(nft.source_asset_id);
    return buildNftMetadata({ nftAsset: nft, asset, baseUrl: this.baseUrl });
  }

  /** PHASE 4 — mint: submit → confirm → verify → only then MINTED. */
  async mint(nftId, { wallet, headers } = {}) {
    this._checkMintAuth(headers);
    const nft = this._get('nft_assets', nftId);
    if (!nft) throw new NotFoundError('NFT asset not found');
    const to = this._requireWallet(wallet || nft.creator_id);
    if (nft.status === 'minted' || nft.status === 'minting') {
      throw new ValidationError(`NFT asset already ${nft.status}`);
    }
    if (await this.chain.contentHashTaken(nft.content_hash)) {
      throw new ValidationError('content hash already minted on-chain');
    }

    const mint = {
      id: id(), asset_id: nft.id, chain: 'evm', network: this.chain.mode,
      chain_id: this.chain.chainId ?? null, contract_address: this.chain.contractAddresses().nft,
      token_id: null, transaction_hash: null, wallet_address: to,
      status: 'minting', verified_at: null, created_at: now(),
      chain_mode: this.chain.mode
    };
    nft.status = 'minting'; nft.updated_at = now();
    this._update('nft_assets', nft); this._put('nft_mints', mint);

    try {
      const res = await this.chain.mintToken({ to, tokenUri: nft.metadata_uri, contentHash: nft.content_hash });
      mint.transaction_hash = res.txHash; mint.token_id = res.tokenId;
      // independent verification — not trusting our own tx result
      const owner = await this.chain.ownerOf(res.tokenId);
      const uri = await this.chain.tokenURI(res.tokenId);
      if (owner.toLowerCase() !== to.toLowerCase()) throw new Error(`on-chain owner ${owner} != ${to}`);
      if (uri !== nft.metadata_uri) throw new Error(`on-chain tokenURI mismatch: ${uri}`);
      mint.status = 'minted'; mint.verified_at = now();
      nft.status = 'minted'; nft.token_id = res.tokenId; nft.updated_at = now();
      this._update('nft_mints', mint); this._update('nft_assets', nft);
      this._emit('nft.minted', { nft, mint });
      return { nft, mint };
    } catch (e) {
      mint.status = 'mint_failed'; mint.error = e.message;
      nft.status = 'mint_failed'; nft.updated_at = now();
      this._update('nft_mints', mint); this._update('nft_assets', nft);
      this._emit('nft.mint.failed', { nft, mint, error: e.message });
      throw e;
    }
  }

  /** Independent verification — reads the chain, ignores the DB claim. */
  async verify(nftId) {
    const nft = this._get('nft_assets', nftId);
    if (!nft) throw new NotFoundError('NFT asset not found');
    const mint = this._all('nft_mints').filter(m => m.asset_id === nftId).pop() || null;
    if (!mint || mint.status !== 'minted' || mint.token_id == null) {
      return { verified: false, reason: mint ? `mint status ${mint.status}` : 'no mint record', nftAsset: nft.id };
    }
    try {
      const owner = await this.chain.ownerOf(mint.token_id);
      const uri = await this.chain.tokenURI(mint.token_id);
      const receipt = await this.chain.getTxReceipt(mint.transaction_hash);
      const ok = receipt && receipt.status === 1 && uri === nft.metadata_uri;
      return {
        verified: !!ok, tokenId: mint.token_id, owner, tokenUri: uri,
        contract: mint.contract_address, txHash: mint.transaction_hash,
        confirmed: receipt ? receipt.status === 1 : false,
        chainMode: this.chain.mode, nftAsset: nft.id
      };
    } catch (e) {
      return { verified: false, reason: `chain read failed: ${e.message}`, nftAsset: nft.id };
    }
  }

  /** PHASE 6 — list: requires minted NFT + on-chain ownership by seller. */
  async createListing(nftId, { sellerWallet, priceEth }) {
    const nft = this._get('nft_assets', nftId);
    if (!nft || nft.status !== 'minted') throw new ValidationError('only a minted NFT can be listed');
    const seller = this._requireWallet(sellerWallet);
    const priceWei = ethers.parseEther(String(priceEth)).toString();
    if (!(BigInt(priceWei) > 0n)) throw new ValidationError('price must be positive');

    const existing = this._all('nft_listings').find(l => l.asset_id === nftId && l.status === 'listed');
    if (existing) throw new ValidationError(`already listed (${existing.id})`);
    const owner = await this.chain.ownerOf(nft.token_id);
    if (owner.toLowerCase() !== seller.toLowerCase()) {
      throw new ValidationError(`seller ${seller} does not own token ${nft.token_id} on-chain (owner: ${owner})`);
    }

    const res = await this.chain.listToken({ tokenId: nft.token_id, priceWei, seller });
    const onChain = await this.chain.getListing(res.listingId);
    if (!onChain.active || onChain.seller.toLowerCase() !== seller.toLowerCase()) {
      throw new Error('on-chain listing verification failed');
    }
    const listing = {
      id: id(), asset_id: nftId, token_id: nft.token_id, seller_wallet: seller,
      price_wei: priceWei, price_eth: String(priceEth), currency: 'ETH',
      status: 'listed', chain_listing_id: res.listingId,
      listing_tx: res.txHash, expires_at: null, created_at: now(),
      chain_mode: this.chain.mode
    };
    this._put('nft_listings', listing);
    this._emit('nft.listed', { nft, listing });
    return listing;
  }

  /** PHASE 7 — purchase: submit → confirm → verify ownership transfer → record sale. */
  async purchase(listingId, { buyerWallet }) {
    const listing = this._get('nft_listings', listingId);
    if (!listing) throw new NotFoundError('Listing not found');
    if (listing.status !== 'listed') throw new ValidationError(`listing is ${listing.status}`);
    const buyer = this._requireWallet(buyerWallet);
    if (buyer.toLowerCase() === listing.seller_wallet.toLowerCase()) {
      throw new ValidationError('buyer cannot be the seller');
    }
    // stale-listing protection: re-read the chain before paying
    const onChain = await this.chain.getListing(listing.chain_listing_id);
    if (!onChain.active) throw new ValidationError('listing is no longer active on-chain (stale)');
    if (onChain.price !== listing.price_wei) throw new ValidationError('on-chain price changed — refusing purchase');

    const nft = this._get('nft_assets', listing.asset_id);
    const sale = {
      id: id(), listing_id: listing.id, asset_id: listing.asset_id,
      buyer_wallet: buyer, seller_wallet: listing.seller_wallet,
      price_wei: listing.price_wei, price_eth: listing.price_eth, currency: 'ETH',
      transaction_hash: null, status: 'purchase_pending', revenue_status: 'PURCHASE_PENDING',
      verified_at: null, created_at: now(), chain_mode: this.chain.mode
    };
    this._put('nft_sales', sale);
    this._emit('nft.purchase.pending', { sale });

    try {
      sale.status = 'sale_submitted'; sale.revenue_status = 'SALE_SUBMITTED';
      this._update('nft_sales', sale);
      const res = await this.chain.buyListing({ listingId: listing.chain_listing_id, buyer });
      sale.transaction_hash = res.txHash;
      // independent verification: token owner on-chain must now be the buyer
      const owner = await this.chain.ownerOf(listing.token_id);
      if (owner.toLowerCase() !== buyer.toLowerCase()) {
        throw new Error(`ownership verification failed: owner is ${owner}, expected ${buyer}`);
      }
      const receipt = await this.chain.getTxReceipt(res.txHash);
      if (!receipt || receipt.status !== 1) throw new Error('buy transaction not confirmed');
      const feeWei = (BigInt(listing.price_wei) * BigInt(this.chain.feeBps || 250) / 10000n).toString();
      sale.status = 'sale_confirmed'; sale.revenue_status = 'SALE_CONFIRMED';
      sale.platform_fee_wei = feeWei; sale.creator_proceeds_wei = (BigInt(listing.price_wei) - BigInt(feeWei)).toString();
      sale.verified_at = now(); sale.new_owner = owner;
      listing.status = 'closed';
      this._update('nft_sales', sale); this._update('nft_listings', listing);
      this._emit('nft.sale.confirmed', { sale, nft });
      return { sale, listing };
    } catch (e) {
      sale.status = 'sale_failed'; sale.revenue_status = 'SALE_FAILED'; sale.error = e.message;
      this._update('nft_sales', sale);
      this._emit('nft.sale.failed', { sale, error: e.message });
      throw e;
    }
  }

  async cancelListing(listingId, { wallet }) {
    const listing = this._get('nft_listings', listingId);
    if (!listing) throw new NotFoundError('Listing not found');
    if (listing.status !== 'listed') throw new ValidationError(`listing is ${listing.status}`);
    const seller = this._requireWallet(wallet);
    if (seller.toLowerCase() !== listing.seller_wallet.toLowerCase()) throw new ValidationError('only the seller can cancel');
    const res = await this.chain.cancelListing({ listingId: listing.chain_listing_id, seller });
    const owner = await this.chain.ownerOf(listing.token_id);
    if (owner.toLowerCase() !== seller.toLowerCase()) throw new Error('cancel verified but token not returned');
    listing.status = 'cancelled'; listing.cancel_tx = res.txHash;
    this._update('nft_listings', listing);
    this._emit('nft.listing.cancelled', { listing });
    return listing;
  }

  /** Mark a confirmed sale as reconciled into durable revenue state. */
  reconcile(saleId) {
    const sale = this._get('nft_sales', saleId);
    if (!sale) throw new NotFoundError('Sale not found');
    if (sale.revenue_status !== 'SALE_CONFIRMED') throw new ValidationError(`sale is ${sale.revenue_status}, cannot reconcile`);
    sale.revenue_status = 'RECONCILED'; sale.reconciled_at = now();
    this._update('nft_sales', sale);
    this._emit('nft.sale.reconciled', { sale });
    return sale;
  }

  /** Durable summary for Heidi / read paths. */
  summary() {
    return {
      chainMode: this.chain.mode,
      contracts: this.chain.contractAddresses(),
      nftAssets: this._all('nft_assets'),
      mints: this._all('nft_mints'),
      listings: this._all('nft_listings'),
      sales: this._all('nft_sales')
    };
  }
}

module.exports = { NftService, NFT_STATES, LISTING_STATES, SALE_STATES };
