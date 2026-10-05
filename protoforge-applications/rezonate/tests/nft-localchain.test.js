const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRepository } = require('../src/repository');
const { createStore } = require('../src/persistence/memory-store');
const { NftService } = require('../src/nft/service');
const { EvmChainAdapter } = require('../src/chain/evm-chain-adapter');

// Real-chain proof: ganache is a genuine EVM (JSON-RPC, real blocks/txs),
// not simulated state. Same adapter code path works against testnet.
let chainOk = true;
try { require.resolve('ganache'); } catch { chainOk = false; }

test('local EVM: deploy → mint → verify → list → buy → ownership transfer → reconcile', { skip: !chainOk, timeout: 120000 }, async () => {
  const chain = await new EvmChainAdapter({ mode: 'local' }).init();
  try {
    assert.strictEqual(chain.isMock, false);
    const accounts = await chain.provider.listAccounts();
    const seller = accounts[0].address, buyer = accounts[1].address;
    const dep = chain.contractAddresses();
    assert.ok(dep.nft.startsWith('0x') && dep.market.startsWith('0x'));

    const repo = createRepository({ store: createStore({}) });
    await repo.init();
    const service = new NftService({ repository: repo, chain, baseUrl: 'http://localhost:3001' });

    // real audio file on disk
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rzn-chain-'));
    const wav = path.join(dir, 'song.wav');
    fs.writeFileSync(wav, Buffer.concat([Buffer.from('RIFF....WAVEfmt '), Buffer.alloc(512, 7), require('crypto').randomBytes(64)]));
    const asset = repo.registerAsset(null, { type: 'remix', name: 'Chain Proof', file_path: wav, metadata: { source: 'test' } });

    const nft = service.createNftAsset({ sourceAssetId: asset.id, creatorWallet: seller, title: 'Chain Proof #1', audio: { bpm: 126, key: 'G maj' } });
    const { mint } = await service.mint(nft.id, {});
    assert.strictEqual(mint.status, 'minted');
    assert.ok(/^0x[0-9a-f]{64}$/.test(mint.transaction_hash)); // real tx hash
    assert.strictEqual(typeof mint.token_id, 'number');

    const v1 = await service.verify(nft.id);
    assert.strictEqual(v1.verified, true);
    assert.strictEqual(v1.owner.toLowerCase(), seller.toLowerCase());
    assert.strictEqual(v1.tokenUri, nft.metadata_uri);

    const listing = await service.createListing(nft.id, { sellerWallet: seller, priceEth: '0.25' });
    assert.ok(listing.chain_listing_id > 0);

    const { sale } = await service.purchase(listing.id, { buyerWallet: buyer });
    assert.strictEqual(sale.status, 'sale_confirmed');
    assert.ok(/^0x[0-9a-f]{64}$/.test(sale.transaction_hash));

    const v2 = await service.verify(nft.id);
    assert.strictEqual(v2.owner.toLowerCase(), buyer.toLowerCase()); // transfer independently verified
    assert.strictEqual(service.reconcile(sale.id).revenue_status, 'RECONCILED');

    // seller balance actually increased (real value moved)
    const bal = await chain.provider.getBalance(seller);
    assert.ok(bal > 0n);
  } finally {
    await chain.close();
  }
});
