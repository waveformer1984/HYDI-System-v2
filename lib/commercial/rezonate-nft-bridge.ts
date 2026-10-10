import { getEventBus } from '../event-bus';
import { adaptRezonateNftSale, publishCommercialEvent } from './ingress-adapter';

const DEFAULT_REZONATE_BASE = 'http://localhost:3001';

interface RezonateSale {
  id: string;
  asset_id: string;
  listing_id: string;
  transaction_hash: string | null;
  seller_wallet: string;
  buyer_wallet: string;
  price_eth: number;
  platform_fee_wei?: string;
  creator_proceeds_wei?: string;
  status: string;
  revenue_status: string;
  verified_at: string | null;
  chain_mode?: string;
  commercial_event_id?: string;
}

interface RezonateChainStatus {
  chain: { nft: string | null; market: string | null; mode: string; chainId: number };
}

export interface NftBridgeResult {
  available: boolean;
  synced: number;
  recovered: number;
  skipped: number;
  errors: string[];
  events: Array<{ sale_id: string; transaction_hash: string; event_id: string }>;
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean; status: number; json: () => Promise<unknown>;
}>;

/**
 * Pulls chain-verified Rezonate NFT sales into the ProtoForge commercial
 * fabric. The transaction hash is the immutable correlation key; a sale is
 * only bridged after the Rezonate service has independently confirmed the
 * receipt and ownership transfer (revenue_status CHAIN_VERIFIED).
 *
 * Idempotent: sales already carrying commercial_event_id are skipped, a
 * tx-hash already folded into the projection is never published twice, and
 * sales stuck at COMMERCIAL_EVENT_CREATED (crash between the two marks)
 * get their REVENUE_RECORDED mark retried.
 */
export async function syncRezonateNftRevenue(
  opts: { baseUrl?: string; fetchImpl?: FetchLike } = {}
): Promise<NftBridgeResult> {
  const base = (opts.baseUrl ?? process.env.REZONATE_APP_URL ?? DEFAULT_REZONATE_BASE).replace(/\/$/, '');
  const http = (opts.fetchImpl ?? (fetch as unknown as FetchLike));
  const result: NftBridgeResult = { available: true, synced: 0, recovered: 0, skipped: 0, errors: [], events: [] };

  let sales: RezonateSale[];
  let chainStatus: RezonateChainStatus;
  try {
    const [salesRes, statusRes] = await Promise.all([
      http(`${base}/nft/sales`),
      http(`${base}/nft/status`),
    ]);
    if (!salesRes.ok) throw new Error(`/nft/sales → ${salesRes.status}`);
    if (!statusRes.ok) throw new Error(`/nft/status → ${statusRes.status}`);
    sales = ((await salesRes.json()) as { sales: RezonateSale[] }).sales;
    chainStatus = (await statusRes.json()) as RezonateChainStatus;
  } catch (err) {
    result.available = false;
    result.errors.push(`rezonate unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const bus = getEventBus();
  const bridgedTx = new Set(
    bus.getHistory({ type: 'rezonate.nft_sale' }).map((e) => e.correlationId)
  );

  for (const sale of sales) {
    // Crash recovery: commercial event created but REVENUE_RECORDED never landed.
    if (sale.commercial_event_id && sale.revenue_status === 'COMMERCIAL_EVENT_CREATED') {
      try {
        await postJson(http, `${base}/nft/sales/${sale.id}/revenue-recorded`, {});
        result.recovered++;
      } catch (err) {
        result.errors.push(`recover ${sale.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    const verified = sale.status === 'sale_confirmed'
      && sale.transaction_hash
      && ['CHAIN_VERIFIED', 'SALE_CONFIRMED'].includes(sale.revenue_status);
    // Pre-V1.1 sale reconciled before the commercial fabric existed — still
    // needs the event attached for a complete audit trail.
    const needsLinkage = sale.status === 'sale_confirmed'
      && sale.transaction_hash
      && !sale.commercial_event_id
      && ['REVENUE_RECORDED', 'RECONCILED'].includes(sale.revenue_status);
    if (!(verified || needsLinkage) || sale.commercial_event_id) {
      if (sale.status !== 'purchase_pending' && sale.status !== 'sale_submitted') result.skipped++;
      continue;
    }
    const txHash = sale.transaction_hash as string;

    try {
      const assetRes = await http(`${base}/nft/assets/${sale.asset_id}`);
      if (!assetRes.ok) throw new Error(`/nft/assets/${sale.asset_id} → ${assetRes.status}`);
      const asset = (await assetRes.json()) as { mint?: { contract_address: string; token_id: string } };
      const mint = asset.mint;
      if (!mint?.contract_address || mint.token_id == null) throw new Error('asset has no verified mint record');

      let eventId = bus.getHistory({ type: 'rezonate.nft_sale' })
        .find((e) => e.correlationId === txHash)?.id;
      if (!eventId) {
        const { type, payload, source, correlationId } = adaptRezonateNftSale(
          sale as Parameters<typeof adaptRezonateNftSale>[0],
          {
            chainId: chainStatus.chain.chainId,
            contractAddress: mint.contract_address,
            tokenId: String(mint.token_id),
            mode: chainStatus.chain.mode,
          }
        );
        const event = await publishCommercialEvent(type, payload, {
          source,
          correlationId,
          causationId: txHash,
        });
        eventId = event.id;
        bridgedTx.add(txHash);
        result.events.push({ sale_id: sale.id, transaction_hash: txHash, event_id: event.id });
      }
      await postJson(http, `${base}/nft/sales/${sale.id}/commercial-event`, { event_id: eventId });
      // Either way the sale now has durable event linkage — mark recorded.
      await postJson(http, `${base}/nft/sales/${sale.id}/revenue-recorded`, {});
      result.synced++;
    } catch (err) {
      result.errors.push(`sale ${sale.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

async function postJson(http: FetchLike, url: string, body: Record<string, unknown>): Promise<void> {
  const res = await http(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
}
