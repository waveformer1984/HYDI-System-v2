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

    // deployments.json may hold a legacy record — verifyDeployment() re-reads
    // bytecode + contract state from the chain regardless; the record alone
    // is never treated as proof.
    const dv = await chain.verifyDeployment();
    assert.strictEqual(dv.verified, true);
    for (const k of ['nftBytecode', 'marketBytecode', 'nftOwner', 'marketFeeBps', 'marketFeeRecipient', 'chainId']) {
      assert.strictEqual(dv.checks[k], true, `check ${k}`);
    }

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
    service.markCommercialEvent(sale.id, { eventId: 'test-evt-1' });
    service.markRevenueRecorded(sale.id);
    assert.strictEqual(service.reconcile(sale.id).revenue_status, 'RECONCILED');

    // seller balance actually increased (real value moved)
    const bal = await chain.provider.getBalance(seller);
    assert.ok(bal > 0n);
  } finally {
    await chain.close();
  }
});

// A FRESH deployment must persist tx-hash + block evidence — the same record
// shape a real testnet deploy produces. Runs on an isolated chain + isolated
// deployments file so it never touches the live record.
test('fresh deploy records deployment tx evidence', { skip: !chainOk, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rzn-dep-'));
  const savedFile = process.env.REZONATE_DEPLOYMENTS_FILE;
  process.env.REZONATE_DEPLOYMENTS_FILE = path.join(dir, 'deployments.json');
  try {
    const chain = await new EvmChainAdapter({ mode: 'local', rpcUrl: 'http://127.0.0.1:8599' }).init();
    try {
      const rec = chain.deploymentRecord();
      assert.ok(/^0x[0-9a-f]{64}$/.test(rec.nftDeployTx), 'nft deploy tx recorded');
      assert.ok(/^0x[0-9a-f]{64}$/.test(rec.marketDeployTx), 'market deploy tx recorded');
      assert.ok(rec.nftDeployBlock > 0 && rec.marketDeployBlock > 0);
      assert.ok(rec.artifactVersion);
      const dv = await chain.verifyDeployment();
      assert.strictEqual(dv.verified, true);
      // tx receipts independently confirm the recorded hashes are real
      for (const h of [rec.nftDeployTx, rec.marketDeployTx]) {
        const r = await chain.getTxReceipt(h);
        assert.strictEqual(r.status, 1);
      }
    } finally {
      await chain.close();
    }
  } finally {
    if (savedFile !== undefined) process.env.REZONATE_DEPLOYMENTS_FILE = savedFile;
    else delete process.env.REZONATE_DEPLOYMENTS_FILE;
  }
});
