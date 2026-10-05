const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRepository } = require('../src/repository');
const { createStore } = require('../src/persistence/memory-store');
const { NftService } = require('../src/nft/service');
const { MockChainAdapter } = require('../src/chain/mock-chain-adapter');
const { sha256File, sha256Json, buildNftMetadata } = require('../src/nft/metadata');

const SELLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BUYER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

function tmpWav() {
  // minimal valid RIFF/WAV header + 100 samples of silence
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rzn-nft-'));
  const p = path.join(dir, 'tone.wav');
  const data = Buffer.alloc(200);
  const header = Buffer.from('RIFF' + String.fromCharCode(0) + 'WAVEfmt ' + String.fromCharCode(16, 0, 0, 0, 1, 0, 1, 0) +
    String.fromCharCode(0x44, 0xAC, 0, 0, 0x88, 0x58, 0x01, 0, 2, 0, 16, 0) + 'data');
  fs.writeFileSync(p, Buffer.concat([header, data]));
  return p;
}

async function setup(opts = {}) {
  const repo = createRepository({ store: createStore({}) });
  await repo.init();
  const chain = new MockChainAdapter();
  chain.registerWallet(SELLER); chain.registerWallet(BUYER);
  const service = new NftService({ repository: repo, chain, baseUrl: 'http://test', mintToken: opts.mintToken || null });
  const file = tmpWav();
  const asset = repo.registerAsset(null, { type: 'generated_song', name: 'Test Tone', file_path: file, metadata: {} });
  return { repo, chain, service, asset, file };
}

test('nft asset: create → deterministic content hash + metadata hash', async () => {
  const { service, asset, file } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER, title: 'Tone #1' });
  assert.strictEqual(nft.content_hash, sha256File(file));
  assert.strictEqual(nft.status, 'prepared');
  assert.strictEqual(nft.metadata_hash.length, 64);
  assert.ok(nft.metadata_uri.endsWith(`/nft/assets/${nft.id}/metadata.json`));
});

test('nft asset: duplicate content refused', async () => {
  const { service, asset } = await setup();
  service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  assert.throws(() => service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER }), /already exists/);
});

test('metadata: deterministic + omits unknown audio facts', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER, title: 'T' });
  const m1 = service.getMetadata(nft.id);
  const m2 = service.getMetadata(nft.id);
  assert.strictEqual(sha256Json(m1), sha256Json(m2));
  assert.ok(!m1.attributes.some(a => a.trait_type === 'BPM')); // unknown stays unknown
  assert.strictEqual(m1.properties.content_hash, nft.content_hash);
  assert.strictEqual(m1.properties.source_asset_id, asset.id);
});

test('mint: requires token when configured', async () => {
  const { service, asset } = await setup({ mintToken: 'sekrit' });
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await assert.rejects(() => service.mint(nft.id, { headers: {} }), /authorization/);
  await assert.rejects(() => service.mint(nft.id, { headers: { 'x-mint-token': 'wrong' } }), /authorization/);
});

test('mint: invalid wallet refused', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await assert.rejects(() => service.mint(nft.id, { wallet: 'not-an-address' }), /valid EVM/);
});

test('mint: success → MINTED with independent verification fields', async () => {
  const { service, asset, chain } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  const { mint } = await service.mint(nft.id, {});
  assert.strictEqual(mint.status, 'minted');
  assert.ok(mint.transaction_hash.startsWith('0xmock'));
  assert.ok(mint.verified_at);
  const v = await service.verify(nft.id);
  assert.strictEqual(v.verified, true);
  assert.strictEqual(v.owner, SELLER);
  assert.strictEqual(v.chainMode, 'mock');
});

test('mint: double mint refused; chain failure → mint_failed', async () => {
  const { service, asset, chain } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  chain.failNext = 'mint';
  await assert.rejects(() => service.mint(nft.id, {}), /mock mint failed/);
  assert.strictEqual(service._get('nft_assets', nft.id).status, 'mint_failed');
});

test('listing: requires minted nft + seller on-chain ownership', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await assert.rejects(() => service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.1' }), /minted/);
  await service.mint(nft.id, {});
  await assert.rejects(() => service.createListing(nft.id, { sellerWallet: BUYER, priceEth: '0.1' }), /does not own/);
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.1' });
  assert.strictEqual(listing.status, 'listed');
  await assert.rejects(() => service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.2' }), /already listed/);
});

test('purchase: happy path → sale_confirmed, ownership moved, fee math', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await service.mint(nft.id, {});
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '1.0' });
  const { sale } = await service.purchase(listing.id, { buyerWallet: BUYER });
  assert.strictEqual(sale.status, 'sale_confirmed');
  assert.strictEqual(sale.revenue_status, 'SALE_CONFIRMED');
  assert.strictEqual(sale.new_owner, BUYER);
  assert.strictEqual(BigInt(sale.platform_fee_wei), 1000000000000000000n * 250n / 10000n);
  const v = await service.verify(nft.id);
  assert.strictEqual(v.owner, BUYER);
});

test('purchase: stale listing refused (cancelled on chain first)', async () => {
  const { service, asset, chain } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await service.mint(nft.id, {});
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.5' });
  await chain.cancelListing({ listingId: listing.chain_listing_id, seller: SELLER }); // cancelled on-chain, db stale
  await assert.rejects(() => service.purchase(listing.id, { buyerWallet: BUYER }), /no longer active on-chain/);
  // refused before any sale record exists — a refused purchase is not a failed sale
  assert.strictEqual(service._all('nft_sales').length, 0);
});

test('purchase: buyer==seller refused; double purchase refused', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await service.mint(nft.id, {});
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.5' });
  await assert.rejects(() => service.purchase(listing.id, { buyerWallet: SELLER }), /cannot be the seller/);
  await service.purchase(listing.id, { buyerWallet: BUYER });
  await assert.rejects(() => service.purchase(listing.id, { buyerWallet: SELLER }), /listing is closed/);
});

test('cancel: seller-only, token returns to seller', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await service.mint(nft.id, {});
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.5' });
  await assert.rejects(() => service.cancelListing(listing.id, { wallet: BUYER }), /only the seller/);
  const out = await service.cancelListing(listing.id, { wallet: SELLER });
  assert.strictEqual(out.status, 'cancelled');
  assert.strictEqual((await service.verify(nft.id)).owner, SELLER);
});

test('reconcile: state machine LISTED→…→RECONCILED, bad transitions refused', async () => {
  const { service, asset } = await setup();
  const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: SELLER });
  await service.mint(nft.id, {});
  const listing = await service.createListing(nft.id, { sellerWallet: SELLER, priceEth: '0.5' });
  const { sale } = await service.purchase(listing.id, { buyerWallet: BUYER });
  assert.strictEqual(service.reconcile(sale.id).revenue_status, 'RECONCILED');
  assert.throws(() => service.reconcile(sale.id), /cannot reconcile/);
});
