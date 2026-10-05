const crypto = require('crypto');

/**
 * In-memory chain adapter for UNIT TESTS ONLY.
 * Every record it produces is stamped chainMode 'mock' and isMock=true;
 * these objects must never be presented as real chain state.
 */
class MockChainAdapter {
  constructor() {
    this.mode = 'mock';
    this.isMock = true;
    this.chainId = 0;
    this.tokens = new Map();      // tokenId -> {owner, uri, contentHash}
    this.listings = new Map();    // listingId -> {seller, tokenId, price, active}
    this._token = 0; this._listing = 0;
    this.wallets = new Set();
    this.failNext = null;         // test hook: 'mint'|'buy'|'list'
  }

  async init() { return this; }
  contractAddresses() { return { nft: '0xMOCKNFT', market: '0xMOCKMKT', mode: 'mock', chainId: 0 }; }
  registerWallet(a) { this.wallets.add(a.toLowerCase()); }
  async defaultWallet() { return '0xMOCKCREATOR'; }
  async signerFor(address) {
    if (!this.wallets.has(address.toLowerCase())) throw new Error(`no signer available for wallet ${address}`);
    return { address };
  }
  _tx() { return '0xmock' + crypto.randomBytes(28).toString('hex'); }

  async mintToken({ to, tokenUri, contentHash }) {
    if (this.failNext === 'mint') { this.failNext = null; throw new Error('mock mint failed'); }
    if (await this.contentHashTaken(contentHash)) { const e = new Error('content already minted'); e.code = 'DUP'; throw e; }
    const tokenId = ++this._token;
    this.tokens.set(tokenId, { owner: to, uri: tokenUri, contentHash });
    return { tokenId, txHash: this._tx(), blockNumber: this._token };
  }

  async ownerOf(tokenId) {
    const t = this.tokens.get(tokenId);
    if (!t) { const e = new Error('ERC721: invalid token ID'); e.code = 'BAD_TOKEN'; throw e; }
    return t.owner;
  }
  async tokenURI(tokenId) { const t = this.tokens.get(tokenId); return t ? t.uri : ''; }
  async contentHashTaken(h) {
    for (const t of this.tokens.values()) if (t.contentHash === h) return true;
    return false;
  }

  async listToken({ tokenId, priceWei, seller }) {
    if (this.failNext === 'list') { this.failNext = null; throw new Error('mock list failed'); }
    const t = this.tokens.get(tokenId);
    if (!t) throw new Error('token does not exist');
    if (t.owner.toLowerCase() !== seller.toLowerCase()) throw new Error('not token owner');
    const listingId = ++this._listing;
    this.listings.set(listingId, { seller, nft: '0xMOCKNFT', tokenId, price: String(priceWei), active: true });
    t.owner = '0xMOCKMKT'; // escrowed
    return { listingId, txHash: this._tx(), blockNumber: 1 };
  }

  async buyListing({ listingId, buyer }) {
    if (this.failNext === 'buy') { this.failNext = null; throw new Error('mock buy failed'); }
    const l = this.listings.get(listingId);
    if (!l || !l.active) throw new Error(`listing ${listingId} is not active on-chain`);
    l.active = false;
    this.tokens.get(l.tokenId).owner = buyer;
    return { txHash: this._tx(), blockNumber: 1, fee: '0' };
  }

  async cancelListing({ listingId, seller }) {
    const l = this.listings.get(listingId);
    if (!l || !l.active) throw new Error('listing not active');
    if (l.seller.toLowerCase() !== seller.toLowerCase()) throw new Error('not seller');
    l.active = false;
    this.tokens.get(l.tokenId).owner = seller;
    return { txHash: this._tx() };
  }

  async getListing(listingId) {
    const l = this.listings.get(listingId);
    if (!l) return { active: false };
    return { ...l };
  }

  async getTxReceipt(h) { return { status: 1, transactionHash: h }; }
  async blockNumber() { return this._token; }
  async close() {}
}

module.exports = { MockChainAdapter };
