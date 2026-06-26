#!/usr/bin/env node
/**
 * Phase 3: Seed Procedural Memory
 *
 * Populate hydi_facts with operational knowledge across all divisions.
 * This gives Heidi the "context" to answer questions and make decisions.
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Generate content_key hash for deduplication
 */
function generateContentKey(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate embedding via Ollama
 */
async function generateEmbedding(text) {
  try {
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text
      })
    });

    if (!response.ok) {
      console.warn(`[SEED] Embedding generation failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data.embedding || null;
  } catch (error) {
    console.warn(`[SEED] Embedding error: ${error.message}`);
    return null;
  }
}

/**
 * Procedural memory facts for each division
 */
const memoryFactsDatabase = {
  appforge: [
    {
      content: 'AppForge infrastructure runs on Google Cloud Platform (GCP) with Firestore as primary database. Migration to multi-region active-active is scheduled for Q3 2026.',
      confidence: 0.92,
      keywords: ['infrastructure', 'GCP', 'Firestore', 'database']
    },
    {
      content: 'AppForge deployment pipeline uses GitHub Actions with staging promotion. All PRs require at least 1 approval and passing contract tests. Production deploys require explicit GitHub release tag.',
      confidence: 0.95,
      keywords: ['deployment', 'CI/CD', 'GitHub', 'testing']
    },
    {
      content: 'AppForge CI/CD has a 15-minute SLA for test completion. Flaky tests that fail >10% are automatically reported to #devops Slack channel.',
      confidence: 0.88,
      keywords: ['SLA', 'tests', 'reliability']
    },
    {
      content: 'AppForge Firestore has RLS (Row Level Security) policies enforced. Service accounts must have explicit grants. Default deny all except service_role.',
      confidence: 0.94,
      keywords: ['security', 'RLS', 'access control']
    },
    {
      content: 'AppForge API rate limiting: 1000 req/min per user, 10000 req/min per service account. Burst capacity allows 2x for 60 seconds. Excess requests receive 429 Too Many Requests.',
      confidence: 0.91,
      keywords: ['rate limiting', 'API', 'quota']
    }
  ],

  crypto: [
    {
      content: 'Crypto Ops trading is disabled when market volatility (VIX) exceeds 30. All positions are force-liquidated at market open if margin falls below 150%. This is non-negotiable for regulatory compliance.',
      confidence: 0.97,
      keywords: ['trading', 'risk', 'VIX', 'margin']
    },
    {
      content: 'Crypto Ops uses a conservative 2% position size rule per trade. Max portfolio heat is 10% across all open positions. Stop loss is always set at 2x ATR (Average True Range).',
      confidence: 0.93,
      keywords: ['position sizing', 'risk management', 'stop loss']
    },
    {
      content: 'Crypto Ops rebalances portfolio daily at 4 PM UTC when crypto markets are most liquid. Rebalancing includes tax-loss harvesting to offset realized gains.',
      confidence: 0.89,
      keywords: ['rebalancing', 'tax', 'liquidity']
    },
    {
      content: 'Crypto Ops mining rig produces approximately 0.15 BTC/month at current difficulty. Revenue after electricity (~$800/month) is approximately $4200/month. Hardware ROI is 18 months.',
      confidence: 0.85,
      keywords: ['mining', 'revenue', 'ROI', 'cost']
    },
    {
      content: 'Crypto Ops is registered with FinCEN as a Money Services Business (MSB). All trades over $10k must be reported. KYC verified up to $100k/day withdrawal limit.',
      confidence: 0.96,
      keywords: ['compliance', 'FinCEN', 'KYC', 'regulation']
    }
  ],

  creative: [
    {
      content: 'Rezonate audio production pipeline: ingest WAV → AI stem separation → MIDI extraction → re-synthesis → export as multi-format (MP3, WAV, FLAC). Processing time: 8 minutes per 3-minute song.',
      confidence: 0.87,
      keywords: ['audio', 'Rezonate', 'production', 'pipeline']
    },
    {
      content: 'Proto-YI design generation uses Gemini vision API to analyze mood boards, then generates 5 concept variations. Cost per generation: $0.002. Average approval rate: 68% (needs human curation).',
      confidence: 0.84,
      keywords: ['design', 'Proto-YI', 'AI', 'cost']
    },
    {
      content: 'Waveformer Records distributes to 12 platforms (Spotify, Apple Music, YouTube, etc.) via DistroKid. Revenue split: 70% artist, 30% label. Payout period: 60 days after distribution.',
      confidence: 0.91,
      keywords: ['distribution', 'music', 'revenue', 'royalties']
    },
    {
      content: 'Creative asset storage is in Google Cloud Storage with lifecycle policies. Hot storage (< 30 days): $0.020/GB/month. Archive storage (> 1 year): $0.004/GB/month. Current usage: 2.4 TB.',
      confidence: 0.89,
      keywords: ['storage', 'cost', 'assets', 'archival']
    }
  ],

  financial: [
    {
      content: 'ForgeFinder unclaimed funds database contains 47,000 records. Average recovery per person: $1,200. Processing fee: 15% + $50 flat fee. Legal compliance: all claims verified against state treasury.',
      confidence: 0.88,
      keywords: ['ForgeFinder', 'unclaimed', 'revenue', 'recovery']
    },
    {
      content: 'Funding Finder sources grants from 500+ foundations. Best ROI sectors: cleantech (45% approval rate), healthcare (38%), education (32%). Application cost: $0 (internal staff). Processing: 2-3 months.',
      confidence: 0.82,
      keywords: ['grants', 'funding', 'approval rate', 'timeline']
    },
    {
      content: 'HQ Finder land deals: target price range $800-1200/acre for commercial zoning. VA loan strategy saves $120k+ on qualified properties. Typical deal timeline: 90 days. Commission structure: 2% finder fee.',
      confidence: 0.86,
      keywords: ['real estate', 'HQ', 'VA loan', 'pricing']
    },
    {
      content: 'ProtoForge cash reserves: $340k in checking, $500k in money market (5.2% APY), $200k in short-term bonds. Burn rate: $28k/month. Runway: 28 months. Target: $1M ARR by Q4 2026.',
      confidence: 0.91,
      keywords: ['cash', 'reserves', 'burn', 'runway']
    }
  ],

  operations: [
    {
      content: 'ProtoForge vendor management: 12 critical vendors (GCP, Supabase, DistroKid, etc.). All have SLAs with 99.9% uptime guarantees. Annual vendor spend: $85k. Audit schedule: quarterly.',
      confidence: 0.90,
      keywords: ['vendors', 'SLA', 'spend', 'compliance']
    },
    {
      content: 'PorchWise family onboarding: intake form → background check (48hrs) → initial setup session (1 hr) → 30-day trial (free). Conversion rate: 62%. NPS score: 8.2/10.',
      confidence: 0.83,
      keywords: ['PorchWise', 'onboarding', 'conversion', 'satisfaction']
    },
    {
      content: 'Toby CLI agent registration requires: manifest JSON, health check endpoint, service account credentials. Agents can claim leases for up to 120 seconds. Auto-renewal every 90 seconds if healthy.',
      confidence: 0.91,
      keywords: ['Toby', 'agents', 'registration', 'lease']
    },
    {
      content: 'ProtoForge security audit: conducted quarterly by third-party firm. Latest findings: 2 high-priority (secrets rotation), 4 medium (encryption gaps), 6 low (logging). Target remediation: 30 days.',
      confidence: 0.89,
      keywords: ['security', 'audit', 'findings', 'remediation']
    },
    {
      content: 'Z-Aero Scholarship: awarded $50k/year to 10 aviation students. Partnership with 8 flight schools. Application deadline: June 15 annually. Expected enrollment impact: 12-15 new pilots over 10 years.',
      confidence: 0.85,
      keywords: ['nonprofit', 'scholarship', 'aviation', 'impact']
    }
  ],

  heidi: [
    {
      content: 'Heidi procedural memory system uses three-tier architecture: Hot (Redis, sub-ms), Warm (pgvector, cosine similarity), Cold (knowledge graph). Total capacity: 100k facts per division.',
      confidence: 0.93,
      keywords: ['Heidi', 'memory', 'architecture', 'capacity']
    },
    {
      content: 'Heidi decision bounds: auto-approve threshold is 0.85 confidence. Max auto-approve amount is $10,000 per transaction. Lease TTL is 120 seconds with renewal every 90s. All decisions logged to heidi_events.',
      confidence: 0.96,
      keywords: ['Heidi', 'decision', 'bounds', 'limits']
    },
    {
      content: 'Heidi reflection cycle runs every 60 minutes. Analyzes last 20 decisions, reports approval/block/review rates, suggests threshold adjustments. Insights stored in heidi_reflections for autonomous learning.',
      confidence: 0.91,
      keywords: ['Heidi', 'reflection', 'learning', 'feedback']
    },
    {
      content: 'Heidi semantic search uses 1536-dimensional embeddings from Ollama nomic-embed-text model. Similarity threshold for retrieval is 0.6 (cosine). Client-side fallback if pgvector RPC fails.',
      confidence: 0.88,
      keywords: ['Heidi', 'search', 'embeddings', 'retrieval']
    }
  ]
};

/**
 * Seed procedural memory
 */
async function seedMemory() {
  console.log('[SEED] Starting procedural memory seeding...\n');

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalEmbeddings = 0;

  for (const [division, facts] of Object.entries(memoryFactsDatabase)) {
    console.log(`\n[SEED] Division: ${division.toUpperCase()}`);
    console.log(`[SEED] Seeding ${facts.length} facts...`);

    for (const fact of facts) {
      try {
        const contentKey = generateContentKey(fact.content);

        // Generate embedding
        const embedding = await generateEmbedding(fact.content);
        if (embedding) totalEmbeddings++;

        // Upsert to database
        const { data, error } = await supabase
          .from('hydi_facts')
          .upsert(
            {
              content: fact.content,
              confidence: fact.confidence,
              division: division,
              content_key: contentKey,
              embedding: embedding
            },
            { onConflict: 'content_key' }
          )
          .select();

        if (error) {
          console.error(`  ❌ Error: ${error.message}`);
          totalSkipped++;
        } else if (data && data.length > 0) {
          console.log(`  ✅ Inserted: "${fact.content.substring(0, 60)}..."`);
          totalInserted++;
        }
      } catch (error) {
        console.error(`  ❌ Exception: ${error.message}`);
        totalSkipped++;
      }

      // Rate limit to avoid overwhelming Ollama
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('[SEED] Seeding complete!');
  console.log(`[SEED] Inserted: ${totalInserted} facts`);
  console.log(`[SEED] Skipped: ${totalSkipped} facts`);
  console.log(`[SEED] Embeddings generated: ${totalEmbeddings} facts`);
  console.log('='.repeat(70));

  // Verify seeding
  console.log('\n[SEED] Verifying by division:');
  for (const division of Object.keys(memoryFactsDatabase)) {
    const { data, error } = await supabase
      .from('hydi_facts')
      .select('count', { count: 'exact' })
      .eq('division', division);

    if (!error && data) {
      console.log(`  ${division}: ${data[0].count} facts`);
    }
  }

  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  seedMemory().catch(error => {
    console.error('[SEED] Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { seedMemory, memoryFactsDatabase };
