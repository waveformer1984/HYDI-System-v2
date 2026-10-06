const crypto = require('crypto');
const fs = require('fs');

/** sha256 of file contents (hex, no 0x). */
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Deterministic sha256 of a JSON object (sorted keys). */
function sha256Json(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/**
 * Deterministic ERC-721 metadata for a Rezonate audio asset.
 * Unknown audio facts (bpm/key/duration) are omitted — never invented.
 */
function buildNftMetadata({ nftAsset, asset, baseUrl }) {
  const attributes = [];
  const push = (trait, value) => { if (value !== undefined && value !== null && value !== '') attributes.push({ trait_type: trait, value }); };

  push('BPM', asset.bpm ?? nftAsset.audio?.bpm);
  push('Key', asset.key ?? nftAsset.audio?.key);
  push('Duration (s)', nftAsset.audio?.duration_seconds);
  push('Sample Rate', nftAsset.audio?.sample_rate);
  push('Asset Type', asset.type);
  push('Stem', nftAsset.audio?.stem);
  push('Engine', nftAsset.audio?.engine || 'rezonate');

  const meta = {
    name: nftAsset.title,
    description: nftAsset.description || '',
    image: nftAsset.artwork_uri || `${baseUrl}/nft/assets/${nftAsset.id}/artwork`,
    animation_url: `${baseUrl}/assets/${asset.id}/file`,
    external_url: `${baseUrl}/nft/assets/${nftAsset.id}`,
    attributes,
    properties: {
      creator: nftAsset.creator_id,
      source_asset_id: asset.id,
      content_hash: nftAsset.content_hash,
      provenance_manifest_url: nftAsset.provenance_manifest ? `${baseUrl}/nft/assets/${nftAsset.id}/provenance` : null,
      provenance_manifest_hash: nftAsset.provenance_manifest_hash || null,
      engine_version: nftAsset.audio?.engine_version || null
    }
  };
  return meta;
}

module.exports = { sha256File, sha256Json, stableStringify, buildNftMetadata };
