(function () {
  const $ = (id) => document.getElementById(id);
  const api = (p, m, body) => fetch(p, {
    method: m || 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json());

  async function refresh() {
    const st = await api('/nft/status');
    $('chain-tag').textContent =
      `chain: ${st.chain.mode} (id ${st.chain.chainId}) · nft ${st.chain.nft || '—'} · market ${st.chain.market || '—'} · block ${st.blockNumber}`;

    const [assets, listings, sales] = await Promise.all([
      api('/nft/assets'), api('/nft/listings'), api('/nft/sales')
    ]);
    const byId = Object.fromEntries((assets.nftAssets || []).map(a => [a.id, a]));

    $('market-list').innerHTML = (assets.nftAssets || []).map(a => {
      const l = (listings.listings || []).find(x => x.asset_id === a.id && x.status === 'listed');
      return `<div class="row" style="justify-content:space-between">
        <div><b>${a.title}</b><br><small>${a.status} · token ${a.token_id ?? '—'} · <a href="/nft/assets/${a.id}/metadata.json">metadata</a> · <a href="/nft/assets/${a.id}/verify">verify</a></small></div>
        <div>${l ? `<span>${l.price_eth} ETH</span> <button data-buy="${l.id}">Buy</button> <button data-cancel="${l.id}">Cancel</button>`
               : a.status === 'minted' ? `<button data-list="${a.id}">List for sale</button>` : ''}</div>
      </div>`;
    }).join('') || '<p class="note">No NFT assets yet.</p>';

    $('sales-list').innerHTML = (sales.sales || []).map(s =>
      `<div class="row"><div><b>${s.price_eth} ETH</b> — ${s.revenue_status}<br>
       <small>buyer ${s.buyer_wallet} · tx ${s.transaction_hash || '—'}</small></div></div>`).join('')
      || '<p class="note">No sales yet.</p>';

    document.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
      const w = prompt('Buyer wallet (0x…)'); if (!w) return;
      const r = await api(`/nft/listings/${b.dataset.buy}/purchase`, 'POST', { buyerWallet: w });
      if (!r.ok) alert(r.error); refresh();
    });
    document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      const w = prompt('Seller wallet (0x…)'); if (!w) return;
      const r = await api(`/nft/listings/${b.dataset.cancel}/cancel`, 'POST', { wallet: w });
      if (!r.ok) alert(r.error); refresh();
    });
    document.querySelectorAll('[data-list]').forEach(b => b.onclick = async () => {
      const a = byId[b.dataset.list];
      const w = prompt('Seller wallet (0x…)', a ? a.creator_id : ''); if (!w) return;
      const p = prompt('Price in ETH', '0.1'); if (!p) return;
      const r = await api('/nft/listings', 'POST', { nftAssetId: b.dataset.list, sellerWallet: w, priceEth: p });
      if (!r.ok) alert(r.error); refresh();
    });
  }

  $('mint-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('mint-err').hidden = true;
    const created = await api('/nft/assets', 'POST', {
      sourceAssetId: $('m-asset').value.trim(), creatorWallet: $('m-wallet').value.trim(),
      title: $('m-title').value.trim() || undefined
    });
    if (!created.ok) { $('mint-err').textContent = created.error; $('mint-err').hidden = false; return; }
    const minted = await api(`/nft/assets/${created.nftAsset.id}/mint`, 'POST', { wallet: $('m-wallet').value.trim() });
    $('mint-result').innerHTML = minted.ok
      ? `<p>MINTED — token ${minted.mint.token_id} · tx <code>${minted.mint.transaction_hash}</code></p>`
      : `<p class="error">${minted.error}</p>`;
    refresh();
  });

  refresh();
})();
