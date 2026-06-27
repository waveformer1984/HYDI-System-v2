/**
 * InventoryModule — Master App & Product Inventory for ProtoForge
 * 
 * Complete catalog of every app, concept, and marketable product
 * across the HYDI System. Filterable by status, category, and revenue potential.
 * Click any item to see full details in the side panel.
 * 
 * Config: Replace INVENTORY array with API data when available.
 * Error handling: Empty state when no items match filter.
 */
'use client';

import { useState, useMemo } from 'react';
import {
  Package,
  Filter,
  Circle,
  DollarSign,
  FolderOpen,
  ArrowRight,
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  Zap,
  Clock,
  Lightbulb,
  Wrench,
  Rocket,
  FileText,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ItemStatus = 'built' | 'scaffolded' | 'concept' | 'landing';
type ItemCategory =
  | 'revenue-ready'
  | 'platform'
  | 'infrastructure'
  | 'concept'
  | 'venture'
  | 'media'
  | 'devtool';

interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: string;
  assignee?: 'jordan' | 'hydi' | 'agent';
  status: 'pending' | 'in-progress' | 'completed';
}

interface InventoryItem {
  id: string;
  name: string;
  status: ItemStatus;
  category: ItemCategory;
  path: string;
  stack: string;
  description: string;
  revenueModel: string;
  marketable: boolean;
  topTen: boolean;
  section: number;
  actionItems?: ActionItem[];
}

/* ------------------------------------------------------------------ */
/*  Style maps                                                         */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<ItemStatus, { color: string; label: string; bg: string }> = {
  built: { color: '#3fb950', label: 'BUILT', bg: '#3fb95015' },
  scaffolded: { color: '#d29922', label: 'SCAFFOLDED', bg: '#d2992215' },
  concept: { color: '#58a6ff', label: 'CONCEPT', bg: '#58a6ff15' },
  landing: { color: '#8b949e', label: 'LANDING', bg: '#8b949e15' },
};

const CATEGORY_STYLE: Record<ItemCategory, { color: string; label: string; icon: typeof Rocket }> = {
  'revenue-ready': { color: '#3fb950', label: 'Revenue-Ready', icon: DollarSign },
  platform: { color: '#58a6ff', label: 'Platform', icon: Layers },
  infrastructure: { color: '#bc8cff', label: 'Infrastructure', icon: Wrench },
  concept: { color: '#d29922', label: 'Concept', icon: Lightbulb },
  venture: { color: '#f0883e', label: 'Venture', icon: Rocket },
  media: { color: '#f778ba', label: 'Media / IP', icon: FileText },
  devtool: { color: '#8b949e', label: 'Dev Tool', icon: Wrench },
};

const SECTION_LABELS: Record<number, string> = {
  1: 'Revenue-Ready Apps',
  2: 'Platform Apps (In Dev)',
  3: 'Infrastructure & Agent Systems',
  4: 'Concepts & Landing Pages',
  5: 'Business Ventures & Physical Products',
  6: 'Content & Media IP',
  7: 'Developer Tools & Infrastructure',
  8: 'Web Services & APIs',
  9: 'Trading & Crypto Systems',
  10: 'Automation & Ops Features',
};

/* ------------------------------------------------------------------ */
/*  Inventory Data — 87 items                                          */
/* ------------------------------------------------------------------ */

const INVENTORY: InventoryItem[] = [
  // === SECTION 1: Revenue-Ready ===
  {
    id: 'sitegrade-ai',
    name: 'SiteGrade AI',
    status: 'built',
    category: 'revenue-ready',
    path: 'ai-auditor/',
    stack: 'Next.js 14, Tailwind, OpenAI GPT-4o-mini, Stripe, Supabase',
    description: 'Point at a URL → get instant AI-powered SEO/performance/accessibility audit → charge money.',
    revenueModel: 'Free tier (1 audit), Single report ($19), Monthly ($49/mo)',
    marketable: true,
    topTen: true,
    section: 1,
  },
  {
    id: 'hydipay',
    name: 'HydiPay',
    status: 'built',
    category: 'revenue-ready',
    path: 'HydiPay/',
    stack: 'Python/FastAPI, Stripe, PayPal, Square',
    description: 'Multi-gateway payment processing with smart routing, demographic-based payment optimization, freelance payment tools.',
    revenueModel: 'Transaction fees, PaaS for tenants, freelance payment optimization',
    marketable: true,
    topTen: true,
    section: 1,
  },
  {
    id: 'payment-gateway',
    name: 'Payment Gateway (Web Services API)',
    status: 'built',
    category: 'revenue-ready',
    path: 'payment-gateway/',
    stack: 'Python/FastAPI, Stripe webhooks, Supabase',
    description: 'Production payment API with webhook relay, PaaS multi-tenant support. Deployed to Railway.',
    revenueModel: 'API access fees, per-transaction fees',
    marketable: true,
    topTen: false,
    section: 1,
  },
  {
    id: 'protoforge-stack',
    name: 'ProtoForge Stack',
    status: 'built',
    category: 'revenue-ready',
    path: 'protoforge_stack/',
    stack: 'Python/Flask, Stripe, PayPal, Supabase, SQLite',
    description: 'Full payment processing stack with real-time metrics dashboard, service scraper, revenue tracking.',
    revenueModel: 'Service fees, dashboard subscriptions',
    marketable: true,
    topTen: false,
    section: 1,
  },
  {
    id: 'ghostwriter-ai',
    name: 'Ghostwriter AI',
    status: 'built',
    category: 'revenue-ready',
    path: 'revenue-streams/ghostwriter-ai/',
    stack: 'Node.js, HTML/JS frontend',
    description: 'AI-powered ghostwriting service with RAVE training integration, tone matching, content generation.',
    revenueModel: 'Per-piece content generation fees, subscription',
    marketable: true,
    topTen: true,
    section: 1,
  },
  {
    id: 'hydi-tactical',
    name: 'HYDI Tactical / EDC 3D Print Store',
    status: 'built',
    category: 'revenue-ready',
    path: 'revenue-streams/hydi-tactical/',
    stack: 'Node.js, Etsy integration, printing workflow engine',
    description: '8-product tactical/EDC 3D printing portfolio (phone cases, multitools, gear organizers) with Etsy storefront.',
    revenueModel: 'Direct product sales ($15-75 per item), Etsy marketplace',
    marketable: true,
    topTen: true,
    section: 1,
  },
  {
    id: 'freelance-scraper',
    name: 'Freelance Lead Scraper / Job Matcher',
    status: 'built',
    category: 'revenue-ready',
    path: 'HydiPay/job_scraper.py',
    stack: 'Python, SQLite',
    description: 'Scrapes freelance job boards, qualifies leads, generates proposals, optimizes payment collection.',
    revenueModel: 'Tool subscription, lead generation fees',
    marketable: true,
    topTen: true,
    section: 1,
  },

  // === SECTION 2: Platform Apps ===
  {
    id: 'dashhub',
    name: 'DashHub',
    status: 'scaffolded',
    category: 'platform',
    path: 'hydi-dashhub/',
    stack: 'Next.js, React, Tailwind, Firebase, Supabase',
    description: 'Central command dashboard for all HYDI services — agent monitoring, deployment status, system health, revenue tracking.',
    revenueModel: 'SaaS dashboard for managed clients, white-label ops dashboard',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'rezonate',
    name: 'Rezonate (AI-Powered DAW)',
    status: 'scaffolded',
    category: 'platform',
    path: 'rezonate_core/',
    stack: 'Python (OpenGL, audio processing), Hydra integration',
    description: 'AI-powered digital audio workstation with model track system, mixing/mastering suite, rights/royalty management, GPU-rendered widgets.',
    revenueModel: 'Software license, subscription, royalty management fees',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'daw-build',
    name: 'DAW Build Framework',
    status: 'scaffolded',
    category: 'platform',
    path: 'daw_build/',
    stack: 'Python, VS Code shell stripping',
    description: 'Generates stripped VS Code shell + DAW webview extension, wired to Python audio runtime.',
    revenueModel: 'Component of Rezonate platform',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'build-a-mind',
    name: 'Build-A-Mind',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/episode-generator/',
    stack: 'Next.js 14, Firebase, Firestore',
    description: 'Platform to craft digital personalities that learn, adapt, and perform — co-write scripts, act in AI episodes, stream to YouTube/Twitch, mint as NFT entities.',
    revenueModel: 'Subscription, NFT minting fees, enterprise licensing (HR/onboarding bots)',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'story-os',
    name: 'Story OS',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/story-os-gui/',
    stack: 'React/TypeScript',
    description: 'Minimal GUI + copilot for narrative creation — writer\'s desk meets code editor meets control room.',
    revenueModel: 'Creative tool subscription',
    marketable: true,
    topTen: false,
    section: 2,
  },
  {
    id: 'episode-generator',
    name: 'Episode Generator (Prince of Texas)',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/episode-generator/',
    stack: 'Next.js 14, Firebase',
    description: 'AI episode generation with ScenarioEngine, canon validation, ghostwriter interview mode.',
    revenueModel: 'Content generation platform, IP licensing',
    marketable: true,
    topTen: false,
    section: 2,
  },
  {
    id: 'hydi-voice-ui',
    name: 'HYDI Voice UI',
    status: 'scaffolded',
    category: 'platform',
    path: 'hydi-voice-ui/',
    stack: 'Vite, React, TypeScript, Tailwind',
    description: 'Voice-controlled interface for HYDI system — voice commands, voice synthesis, strategy sessions.',
    revenueModel: 'Voice assistant feature for HYDI platform',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'ursula',
    name: 'Ursula (ProtoForge Hub)',
    status: 'scaffolded',
    category: 'platform',
    path: 'ursula/',
    stack: 'Next.js 16, React 19, Tailwind, Lucide',
    description: 'VS Code-style command center for all ProtoForge operations. Module-based IDE shell.',
    revenueModel: 'Platform access, managed service portal',
    marketable: true,
    topTen: false,
    section: 2,
  },
  {
    id: 'hydi-react-app',
    name: 'HYDI React App',
    status: 'scaffolded',
    category: 'platform',
    path: 'HYDI_REACT_APP/',
    stack: 'React, Firebase, Supabase, Vercel',
    description: 'Main HYDI web application with voice commands, graph visualization, classification engine.',
    revenueModel: 'Platform access',
    marketable: true,
    topTen: false,
    section: 2,
  },
  {
    id: 'protoforge-connector',
    name: 'ProtoForge Connector',
    status: 'scaffolded',
    category: 'platform',
    path: 'protoforge-connector/',
    stack: 'TypeScript, Node.js',
    description: 'Integration middleware connecting ProtoForge services — API orchestration, service mesh.',
    revenueModel: 'Infrastructure component',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'webhook-relay',
    name: 'Webhook Relay',
    status: 'built',
    category: 'platform',
    path: 'webhook-relay/',
    stack: 'Vercel serverless, Python',
    description: 'Routes webhooks from Stripe/PayPal to backend services.',
    revenueModel: 'Infrastructure component / developer tool',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'hydi-complete-platform',
    name: 'HYDI Complete Platform',
    status: 'scaffolded',
    category: 'platform',
    path: 'hydi_complete_platform/',
    stack: 'SDK + widget + integrations',
    description: 'Embeddable HYDI platform with SDK, widget, and integration layer — "One Hour Launch" guide.',
    revenueModel: 'PaaS / embedded platform fees, white-label',
    marketable: true,
    topTen: false,
    section: 2,
  },
  {
    id: 'thinkerf',
    name: 'ThinkerF Dashboard',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/thinker-dashboard/',
    stack: 'Python (Dash/Flask)',
    description: 'Analytics and thinking/decision dashboard.',
    revenueModel: 'Analytics tool subscription',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'time-manager',
    name: 'Time Manager',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/time-manager/',
    stack: 'TBD',
    description: 'Time management / scheduling application.',
    revenueModel: 'Productivity tool subscription',
    marketable: false,
    topTen: false,
    section: 2,
  },
  {
    id: 'funding-hub',
    name: 'Funding Hub',
    status: 'scaffolded',
    category: 'platform',
    path: 'apps/funding-hub/',
    stack: 'TBD',
    description: 'Grant finding, funding application management, capital acquisition tools.',
    revenueModel: 'Subscription for grant seekers, commission on funded applications',
    marketable: true,
    topTen: true,
    section: 2,
  },

  // === SECTION 3: Infrastructure & Agent Systems ===
  {
    id: 'hydi-core',
    name: 'HYDI Core (AI Orchestrator)',
    status: 'built',
    category: 'infrastructure',
    path: 'HYDI_CORE/',
    stack: 'TypeScript, React (TSX), Python',
    description: 'Central AI orchestration engine — agent roster, campus map, console, task management, distributed compute.',
    revenueModel: 'Core platform (managed service)',
    marketable: false,
    topTen: false,
    section: 3,
  },
  {
    id: 'hydra-mesh',
    name: 'HYDRA Mesh (Distributed Compute)',
    status: 'built',
    category: 'infrastructure',
    path: 'hydra_core/',
    stack: 'Python, UDP heartbeat, HTTP coordination',
    description: 'Multi-device distributed compute mesh — coordinator + worker nodes, USB deployment.',
    revenueModel: 'Compute-as-a-service, edge computing',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'quanto-engine',
    name: 'HYDRA Quanto Engine',
    status: 'built',
    category: 'infrastructure',
    path: 'quanto_enhanced.py',
    stack: 'Python',
    description: 'Quantum-inspired decision support for crypto, portfolio management, DeFi, risk assessment.',
    revenueModel: 'API access, consulting tool',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'hydi-doors',
    name: 'HYDI Doors (Security Gateway)',
    status: 'built',
    category: 'infrastructure',
    path: 'hydi_doors.py',
    stack: 'Python',
    description: 'Security gateway with MFA, IP whitelisting, threat detection, business integration.',
    revenueModel: 'Security-as-a-service',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'worker-nodes',
    name: 'Worker Node Deployment System',
    status: 'built',
    category: 'infrastructure',
    path: 'nodes/',
    stack: 'Python, batch scripts',
    description: 'Deploy worker agents to remote machines via USB or network — no Python required on target.',
    revenueModel: 'Part of HYDRA mesh',
    marketable: false,
    topTen: false,
    section: 3,
  },
  {
    id: 'market-rnd',
    name: 'Market R&D System',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'market_rnd_system/',
    stack: 'Python',
    description: 'Full R&D pipeline — intake, normalization, classification, scoring, routing, proposals, execution, monetization.',
    revenueModel: 'R&D consulting platform',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'hydi-guardian',
    name: 'HYDI Guardian (System Health)',
    status: 'built',
    category: 'infrastructure',
    path: 'tools/hydi_guardian/',
    stack: 'Python',
    description: 'System health monitoring, network sweep, security scanning.',
    revenueModel: 'Managed service component / MSP tool',
    marketable: false,
    topTen: false,
    section: 3,
  },
  {
    id: 'parallel-exec',
    name: 'Parallel Execution Framework',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'parallel-execution-framework/',
    stack: 'API gateway, Firebase, DashHub frontend, orchestrator',
    description: 'Multi-task parallel execution with monitoring dashboard.',
    revenueModel: 'Platform infrastructure / developer tool',
    marketable: false,
    topTen: false,
    section: 3,
  },
  {
    id: 'operation-autofund',
    name: 'Operation AutoFund',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'operation-autofund/',
    stack: 'Python, HTML',
    description: 'Automated grant/funding discovery and application system.',
    revenueModel: 'Commission on funded grants, subscription',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'gpt4all-bundle',
    name: 'HYDI GPT4All Bundle (Offline AI)',
    status: 'built',
    category: 'infrastructure',
    path: 'HYDI_GPT4All_Bundle/',
    stack: 'Python, GPT4All, Tkinter GUI',
    description: 'Offline local AI assistant with dashboard, drive scanner, memory system, voice, UDP mesh integration.',
    revenueModel: 'Software license (offline AI appliance)',
    marketable: true,
    topTen: false,
    section: 3,
  },
  {
    id: 'forgeling',
    name: 'Forgeling v001 (Standalone EXE)',
    status: 'built',
    category: 'infrastructure',
    path: 'HYDI_GPT4All_Bundle/Forgeling_v001/',
    stack: 'Python → EXE',
    description: 'Standalone AI assistant executable — compiled, downloadable product.',
    revenueModel: 'Software license',
    marketable: true,
    topTen: false,
    section: 3,
  },

  // === SECTION 4: Concepts & Landing Pages ===
  {
    id: 'porchwise',
    name: 'PorchWise',
    status: 'concept',
    category: 'concept',
    path: 'protoforge-landing-suite/porchwise-landing/',
    stack: 'Concept + landing page',
    description: 'AI-powered family management system with pet training module — "Toby" AI assistant, chore assignment, behavior tracking.',
    revenueModel: 'Family app subscription',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'blame-game',
    name: 'Blame Game',
    status: 'concept',
    category: 'concept',
    path: 'protoforge-landing-suite/blamegame-landing/',
    stack: 'Concept + architecture spec',
    description: 'Social/party game concept with architecture spec.',
    revenueModel: 'App purchase, in-app purchases',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'protofragrance',
    name: 'ProtoFragrance',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/protofragrance-landing/',
    stack: 'Landing page only',
    description: 'Custom fragrance / scent product line.',
    revenueModel: 'Direct product sales',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'smokehouse',
    name: "Colter's Little Smokehouse",
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/smokehouse-landing/',
    stack: 'Landing page only',
    description: 'Food/smokehouse brand.',
    revenueModel: 'Food sales, catering',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'secret-shopper',
    name: 'Secret Shopper / Corporate Insight',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/secret-shopper-landing/',
    stack: 'Landing page only',
    description: 'Mystery shopping / corporate intelligence service.',
    revenueModel: 'Per-audit fees, subscription',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'protohub',
    name: 'ProtoHub SaaS',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/protohub-landing/',
    stack: 'Landing page only',
    description: 'Central SaaS hub for ProtoForge services.',
    revenueModel: 'SaaS subscription',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'crypto-fund',
    name: 'Crypto Trading Fund',
    status: 'concept',
    category: 'concept',
    path: 'protoforge-landing-suite/crypto-fund-landing/',
    stack: 'Concept + landing page',
    description: 'Crypto trading fund powered by Quanto engine — portfolio optimization, DeFi risk assessment.',
    revenueModel: 'Fund management fees, API access',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'rnd-consulting',
    name: 'R&D Consulting / Z-Labs / CHDR',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/rnd-consulting-landing/',
    stack: 'Landing page only',
    description: 'R&D consulting service, includes Huntington\'s Disease research fundraising (CHDR).',
    revenueModel: 'Consulting fees, grant-funded research',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'concept-pool',
    name: 'Design Center / Concept Pool',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/concept-pool-landing/',
    stack: 'Landing page only',
    description: 'Design marketplace / concept incubator.',
    revenueModel: 'Design fees, marketplace commission',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'waveformer',
    name: 'Waveformer / Music Production',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/waveformer-landing/',
    stack: 'Landing page (pairs with Rezonate)',
    description: 'Music production service brand — consumer face of Rezonate platform.',
    revenueModel: 'Production fees, licensing, subscription',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'web-services',
    name: 'Web Services Division',
    status: 'landing',
    category: 'concept',
    path: 'protoforge-landing-suite/web-services-landing/',
    stack: 'Landing page only',
    description: 'Web development / managed services offering.',
    revenueModel: 'Project fees, retainers, managed hosting',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'game-room',
    name: 'Game Room Silver-Payout',
    status: 'concept',
    category: 'concept',
    path: 'auto_stack_beta_portal/concepts/game-room-silver-payout/',
    stack: 'React app scaffold',
    description: 'Managed local game room with structured events, station management, silver-based prize payouts, vault system.',
    revenueModel: 'Event fees, station bookings, house edge',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'bitch-tendencies',
    name: 'Bitch Tendencies (Interview Series)',
    status: 'concept',
    category: 'concept',
    path: 'BITCH_TENDENCIES_*.md',
    stack: 'Spec docs',
    description: 'Interview series capturing behavioral patterns for AI training, RAVE emotional mapping, Build-A-Mind character development.',
    revenueModel: 'Content/media, training data generation',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'vaultpath',
    name: 'VaultPath',
    status: 'concept',
    category: 'concept',
    path: 'vaultpath/',
    stack: 'Build package JSON',
    description: 'Secure credential/secret management system.',
    revenueModel: 'Security tool subscription',
    marketable: true,
    topTen: false,
    section: 4,
  },
  {
    id: 'hydi-v15',
    name: 'HYDI v1.5 (Enhanced GUI)',
    status: 'scaffolded',
    category: 'concept',
    path: 'HYDI_v1_5/',
    stack: 'Python, Tkinter',
    description: 'Enhanced desktop GUI version of HYDI assistant.',
    revenueModel: 'Desktop software license',
    marketable: false,
    topTen: false,
    section: 4,
  },

  // === SECTION 5: Business Ventures & Physical Products ===
  {
    id: 'z-aero',
    name: 'Z-AERO (EV Motorcycle Conversion)',
    status: 'concept',
    category: 'venture',
    path: 'Z-AERO/',
    stack: 'Extensive documentation, 3D specs, LLC formation docs',
    description: 'GS550 cafe racer EV conversion — automotive-grade specs, 3D printed parts, manufacturing LLC formation.',
    revenueModel: 'Vehicle sales, conversion kits, parts, GoFundMe campaigns',
    marketable: true,
    topTen: false,
    section: 5,
    actionItems: [
      {
        id: 'z-aero-1',
        title: 'Complete LLC formation',
        description: 'File LLC paperwork, obtain EIN, set up business banking, register trademarks',
        priority: 'high',
        estimatedTime: '8 hours',
        assignee: 'jordan',
        status: 'pending',
      },
      {
        id: 'z-aero-2',
        title: 'Build prototype battery pack',
        description: 'Design and assemble 72V battery pack with BMS, thermal management, mounting system',
        priority: 'high',
        estimatedTime: '20 hours',
        assignee: 'jordan',
        status: 'pending',
      },
      {
        id: 'z-aero-3',
        title: 'Create GoFundMe campaign',
        description: 'Launch crowdfunding campaign with video, rewards, marketing materials',
        priority: 'medium',
        estimatedTime: '6 hours',
        assignee: 'hydi',
        status: 'pending',
      },
      {
        id: 'z-aero-4',
        title: 'Finalize 3D printing designs',
        description: 'Complete CAD models for all 3D printed parts, test prints, material selection',
        priority: 'medium',
        estimatedTime: '12 hours',
        assignee: 'agent',
        status: 'pending',
      },
    ],
  },
  {
    id: '3d-print-line',
    name: '3D Print Product Line',
    status: 'built',
    category: 'venture',
    path: '3d_print_files/',
    stack: 'OpenSCAD, FreeCAD',
    description: '8-product tactical/EDC portfolio + cable management + custom designs. STL files ready.',
    revenueModel: 'Direct sales, Etsy, custom orders',
    marketable: true,
    topTen: true,
    section: 5,
  },
  {
    id: 'hd-fundraiser',
    name: "Huntington's Disease Research Fundraiser",
    status: 'concept',
    category: 'venture',
    path: 'HUNTINGTON_DISEASE_FUNDRAISER.md',
    stack: 'Campaign docs',
    description: 'Fundraising campaign for Council on Huntington\'s Disease Research (CHDR). $50K goal.',
    revenueModel: 'Nonprofit fundraising',
    marketable: false,
    topTen: false,
    section: 5,
  },
  {
    id: 'leadpacks-pro',
    name: 'LeadPacks Pro',
    status: 'scaffolded',
    category: 'venture',
    path: 'LEADPACKS_PRO_IMPLEMENTATION.js',
    stack: 'JavaScript',
    description: 'Lead generation and qualification system for local services.',
    revenueModel: 'Lead pack sales, subscription',
    marketable: true,
    topTen: false,
    section: 5,
  },
  {
    id: 'cyber-services',
    name: 'HYDI Cyber Services',
    status: 'scaffolded',
    category: 'venture',
    path: 'demo_cyber_services.py',
    stack: 'Python',
    description: 'Cybersecurity service offering — network scanning, threat detection, security audits.',
    revenueModel: 'Managed security service, per-audit fees',
    marketable: true,
    topTen: true,
    section: 5,
  },

  // === SECTION 6: Content & Media IP ===
  {
    id: 'prince-of-texas',
    name: 'Prince of Texas (Narrative Universe)',
    status: 'scaffolded',
    category: 'media',
    path: 'apps/ghostwriter-agent/',
    stack: 'Next.js, Firebase, Ghostwriter engine',
    description: 'Complete narrative universe with AI-generated episodes, canon engine, character system.',
    revenueModel: 'Content licensing, streaming, merchandise',
    marketable: true,
    topTen: false,
    section: 6,
  },
  {
    id: 'rave',
    name: 'RAVE (Voice/Emotion System)',
    status: 'scaffolded',
    category: 'media',
    path: 'HYDI_GPT4All_Bundle/rave.py',
    stack: 'Python',
    description: 'Voice listener + emotional mapping + input handler for AI characters.',
    revenueModel: 'Component of Build-A-Mind / Rezonate',
    marketable: false,
    topTen: false,
    section: 6,
  },
  {
    id: 'hydi-always-here',
    name: 'HYDI Always Here',
    status: 'built',
    category: 'media',
    path: 'hydi_always_here.py',
    stack: 'Python + HTML',
    description: 'Always-on AI assistant with tray indicator, persistent monitoring.',
    revenueModel: 'Consumer AI assistant',
    marketable: false,
    topTen: false,
    section: 6,
  },

  // === SECTION 7: Developer Tools ===
  {
    id: 'landing-suite',
    name: 'ProtoForge Landing Suite',
    status: 'built',
    category: 'devtool',
    path: 'protoforge-landing-suite/',
    stack: 'HTML, scaffold pages',
    description: '14 microsite landing pages for all ProtoForge divisions.',
    revenueModel: 'Marketing infrastructure',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'beta-portal',
    name: 'Auto Stack Beta Portal',
    status: 'scaffolded',
    category: 'devtool',
    path: 'auto_stack_beta_portal/',
    stack: 'Node.js (Express), React client',
    description: 'Beta testing portal with concept incubation pipeline.',
    revenueModel: 'Internal tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'protoyi-rcws',
    name: 'ProtoYI RCWS',
    status: 'scaffolded',
    category: 'devtool',
    path: 'ProtoYI_RCWS/',
    stack: 'React, Node.js',
    description: 'Bot hook engine, checkpoint system.',
    revenueModel: 'Developer tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'hydi-grey',
    name: 'HYDI Grey (Ops Module)',
    status: 'scaffolded',
    category: 'devtool',
    path: 'hydi-grey/',
    stack: 'Python',
    description: 'Operational module with config, deployment, exports.',
    revenueModel: 'Internal infrastructure',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'kate',
    name: 'KATE (Test Runner)',
    status: 'scaffolded',
    category: 'devtool',
    path: 'KATE/',
    stack: 'TypeScript',
    description: 'Test runner for partnership integrations, restricted operations handler.',
    revenueModel: 'Internal QA tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'hmh-desktop',
    name: 'HMH Desktop App (Hold My Hand)',
    status: 'scaffolded',
    category: 'devtool',
    path: 'HMH_Desktop_App/',
    stack: 'Python (Cursor chat integration)',
    description: 'Desktop companion app for guided AI assistance, Stripe profile prep, partnership guide.',
    revenueModel: 'Guided onboarding tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'mobile-dashboard',
    name: 'Mobile Dashboard',
    status: 'built',
    category: 'devtool',
    path: 'mobile_dashboard.html',
    stack: 'HTML + Python server',
    description: 'Mobile-responsive system dashboard.',
    revenueModel: 'Platform feature',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'forgejo-connector',
    name: 'HYDI Forgejo Connector',
    status: 'scaffolded',
    category: 'devtool',
    path: 'hydi-forgejo-connector/',
    stack: 'Self-hosted Git integration',
    description: 'Self-hosted Git (Forgejo) integration for HYDI.',
    revenueModel: 'DevOps tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'smartwatch',
    name: 'Smart Watch Integration',
    status: 'scaffolded',
    category: 'devtool',
    path: 'smart_watch_integration.py',
    stack: 'Python',
    description: 'Push alerts and monitoring to smartwatch.',
    revenueModel: 'Platform feature',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'hydi-guardian',
    name: 'HYDI Guardian (Electron Desktop)',
    status: 'built',
    category: 'devtool',
    path: 'tools/hydi_guardian/',
    stack: 'Electron, React, Vite, Python backend, Windows scheduler',
    description: 'Desktop guardian app with system sweeper, scheduled scans, React frontend, Windows executable.',
    revenueModel: 'Security tool licensing',
    marketable: true,
    topTen: false,
    section: 7,
  },

  // === SECTION 8: Web Services & APIs ===
  {
    id: 'mcp-server',
    name: 'HYDI MCP Server',
    status: 'built',
    category: 'platform',
    path: 'mcp-server/',
    stack: 'Node.js, Vercel, Claude API',
    description: 'Model Context Protocol server connecting HYDI task management to ChatGPT/Claude — AI task generation, real-time analytics, queue monitoring.',
    revenueModel: 'API access, developer tool subscription',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'content-api',
    name: 'Content API Service',
    status: 'built',
    category: 'platform',
    path: 'services/content_api_service.py',
    stack: 'Python/Flask, CORS',
    description: 'Content creation, distribution, and API endpoints for the HYDI ecosystem.',
    revenueModel: 'Content-as-a-service API',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'task-automation-service',
    name: 'Task Automation Service',
    status: 'built',
    category: 'platform',
    path: 'services/task_automation_service.py',
    stack: 'Python/Flask, async subprocess',
    description: 'Web service for automated task execution and workflow automation with landing page.',
    revenueModel: 'Automation-as-a-service',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'user-management-service',
    name: 'User Management Service',
    status: 'built',
    category: 'infrastructure',
    path: 'services/user_management_service.py',
    stack: 'Python/Flask, JWT auth',
    description: 'User authentication, profiles, and management for the HYDI ecosystem.',
    revenueModel: 'Platform infrastructure',
    marketable: false,
    topTen: false,
    section: 8,
  },
  {
    id: 'gemini-service',
    name: 'Gemini AI Service',
    status: 'built',
    category: 'platform',
    path: 'services/geminiService.ts',
    stack: 'TypeScript, Google Gemini API',
    description: 'Optimized Gemini AI integration service for content generation and analysis.',
    revenueModel: 'AI service layer',
    marketable: false,
    topTen: false,
    section: 8,
  },
  {
    id: 'lead-packs-service',
    name: 'Lead Packs Service',
    status: 'built',
    category: 'revenue-ready',
    path: 'services/lead_packs_service.py',
    stack: 'Python/Flask',
    description: 'Lead generation and packaging service — creates qualified lead packs for local businesses.',
    revenueModel: 'Lead pack sales, B2B subscription',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'ghostwriter-service',
    name: 'Ghostwriter Service (API)',
    status: 'built',
    category: 'platform',
    path: 'services/ghostwriter_service.py',
    stack: 'Python/Flask',
    description: 'Backend API for ghostwriting content generation — powers the Ghostwriter AI frontend.',
    revenueModel: 'Content generation API',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'rezonate-game-opps',
    name: 'Rezonate Game Opportunities',
    status: 'built',
    category: 'platform',
    path: 'services/rezonate_game_opportunities.py',
    stack: 'Python/Flask',
    description: 'Identifies freelance game dev opportunities that can leverage Rezonate — music games, audio games, interactive music.',
    revenueModel: 'Freelance opportunity matching',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'payment-api-vercel',
    name: 'Payment API (Vercel)',
    status: 'built',
    category: 'infrastructure',
    path: 'payment-api/',
    stack: 'Python, Vercel serverless',
    description: 'Lightweight Vercel-deployed payment API endpoint.',
    revenueModel: 'Payment infrastructure',
    marketable: false,
    topTen: false,
    section: 8,
  },
  {
    id: 'fastapi-runtime',
    name: 'HYDI FastAPI Runtime',
    status: 'built',
    category: 'infrastructure',
    path: 'hydi/runtime/',
    stack: 'Python/FastAPI, multiple variants (minimal, enhanced, hybrid, optimized)',
    description: 'Core API runtime with task queue, email service, voice renderer, 3D model renderer, image renderer, inference optimizer, job manager.',
    revenueModel: 'Core platform runtime',
    marketable: false,
    topTen: false,
    section: 8,
  },

  // === SECTION 9: Trading & Crypto Systems ===
  {
    id: 'hydiquant',
    name: 'HydiQuant (Trading Platform)',
    status: 'scaffolded',
    category: 'platform',
    path: 'hydi_config/HydiQuant/',
    stack: 'React, Vite, Express, Drizzle ORM, Radix UI, Tailwind',
    description: 'Full-stack quantitative trading platform — paper trading, backtesting, strategy engine, risk management, market data, positions, orders dashboard.',
    revenueModel: 'Trading platform subscription, API access',
    marketable: true,
    topTen: false,
    section: 9,
  },
  {
    id: 'crypto-trading-scripts',
    name: 'Crypto Trading Scripts',
    status: 'built',
    category: 'infrastructure',
    path: 'hydi_scripts/',
    stack: 'Python',
    description: 'Real-time crypto monitor, trading fund manager, crypto analysis, smart contract permissions system, swap strategy tools.',
    revenueModel: 'Trading fund management tools',
    marketable: true,
    topTen: false,
    section: 9,
  },
  {
    id: 'smart-contracts',
    name: 'Smart Contract Permissions System',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'hydi_scripts/smart_contracts/',
    stack: 'Python, Solidity specs',
    description: 'Smart contract permissions management with dashboard — 15 contract definitions.',
    revenueModel: 'Web3 infrastructure tool',
    marketable: true,
    topTen: false,
    section: 9,
  },
  {
    id: 'quattro-engine',
    name: 'Quattro Engine',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'quattro_engine/',
    stack: 'Python',
    description: 'Quattro integration engine — extended compute/decision layer for HYDRA mesh.',
    revenueModel: 'Compute infrastructure',
    marketable: false,
    topTen: false,
    section: 9,
  },

  // === SECTION 10: Automation & Ops Features ===
  {
    id: 'golden-run',
    name: 'Golden Run Framework',
    status: 'built',
    category: 'devtool',
    path: 'golden_run/',
    stack: 'Python',
    description: 'Operational baseline and verification system — reproducible test scenarios, agent contracts, instrumentation, automated quality checks.',
    revenueModel: 'QA/DevOps tool',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'cyber-services-api',
    name: 'Cyber Services API',
    status: 'built',
    category: 'revenue-ready',
    path: 'hydi/core/cyber_services/',
    stack: 'Python/FastAPI (60K+ lines)',
    description: 'Full cybersecurity API with task manager, execution engine, optimized execution — network scanning, threat detection, vulnerability assessment.',
    revenueModel: 'Managed security service, per-scan fees',
    marketable: true,
    topTen: false,
    section: 10,
  },
  {
    id: 'billing-engine',
    name: 'Task Billing Engine',
    status: 'built',
    category: 'infrastructure',
    path: 'hydi/core/billing/',
    stack: 'Python',
    description: 'Per-task billing system — tracks compute costs, generates invoices, usage metering.',
    revenueModel: 'Usage-based billing infrastructure',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'checkpoint-system',
    name: 'Checkpoint System',
    status: 'built',
    category: 'infrastructure',
    path: 'hydi/core/checkpoint/',
    stack: 'Python (48K lines)',
    description: 'Comprehensive checkpoint/savepoint system for task state, rollback, and recovery.',
    revenueModel: 'Platform reliability infrastructure',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'biometric-security',
    name: 'Biometric & Behavioral Security',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'hydi/core/security/',
    stack: 'Python',
    description: 'Multi-modal biometrics (40K lines) + behavioral metadata security — advanced auth and threat detection.',
    revenueModel: 'Enterprise security feature',
    marketable: true,
    topTen: false,
    section: 10,
  },
  {
    id: 'ml-curriculum',
    name: 'ML Curriculum System',
    status: 'scaffolded',
    category: 'devtool',
    path: 'ml_curriculum/',
    stack: 'Python, MLflow, Optuna, SHAP, LIME',
    description: 'Comprehensive ML training system — data loading, model training, experiment tracking, interpretability, hyperparameter tuning.',
    revenueModel: 'ML education / internal capability',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'frank-api-server',
    name: 'Frank API Server',
    status: 'scaffolded',
    category: 'infrastructure',
    path: 'protoforge-infrastructure/frank-api-server/',
    stack: 'TypeScript',
    description: 'API server for Frank (worker desktop node) — remote task execution, health monitoring, compute offloading.',
    revenueModel: 'Distributed compute infrastructure',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'stabilization-dashboard',
    name: 'Stabilization Dashboard',
    status: 'built',
    category: 'devtool',
    path: 'dashboard/',
    stack: 'Next.js, React, Vercel',
    description: 'System stabilization monitoring dashboard — tracks build health, deployment status, error rates.',
    revenueModel: 'Ops monitoring tool',
    marketable: false,
    topTen: false,
    section: 10,
  },
  {
    id: 'gitbuddy',
    name: 'GitBuddy',
    status: 'concept',
    category: 'devtool',
    path: 'gitBuddy/',
    stack: 'TBD (empty directory)',
    description: 'Git workflow assistant concept — automated commit messages, PR management, code review helper.',
    revenueModel: 'SaaS tool for developers',
    marketable: true,
    topTen: false,
    section: 7,
    actionItems: [
      {
        id: 'gitbuddy-1',
        title: 'Create technical specification',
        description: 'Define core features: auto-commit messages, PR templates, code review automation, integration points',
        priority: 'high',
        estimatedTime: '2 hours',
        assignee: 'jordan',
        status: 'pending',
      },
      {
        id: 'gitbuddy-2',
        title: 'Build MVP prototype',
        description: 'Create basic CLI tool with commit message generation using OpenAI API',
        priority: 'high',
        estimatedTime: '4 hours',
        assignee: 'jordan',
        status: 'pending',
      },
      {
        id: 'gitbuddy-3',
        title: 'Design VS Code extension',
        description: 'Create extension spec for Git integration with commit suggestions and PR helpers',
        priority: 'medium',
        estimatedTime: '3 hours',
        assignee: 'hydi',
        status: 'pending',
      },
    ],
  },
  {
    id: 'freelance-scraper-service',
    name: 'Freelance Lead Scraper',
    status: 'built',
    category: 'platform',
    path: 'services/freelance_scraper.py',
    stack: 'Python, Web scraping',
    description: 'Automated freelance opportunity discovery and scraping service.',
    revenueModel: 'Lead generation',
    marketable: true,
    topTen: false,
    section: 8,
  },
  {
    id: 'project-ops-dashboard',
    name: 'Project Ops Dashboard',
    status: 'scaffolded',
    category: 'devtool',
    path: 'project-ops/apps/dashboard/',
    stack: 'Next.js, TypeScript, Supabase',
    description: 'Project management dashboard with API server, Supabase storage, migrations.',
    revenueModel: 'Internal tool',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'mobile-api-bridge',
    name: 'Mobile Portal API Bridge',
    status: 'built',
    category: 'devtool',
    path: 'mobile_portal/api_bridge/',
    stack: 'API bridging, Mobile',
    description: 'API bridge for mobile portal connectivity.',
    revenueModel: 'Mobile infrastructure',
    marketable: false,
    topTen: false,
    section: 8,
  },
  {
    id: 'frontend-dashhub',
    name: 'Frontend DashHub',
    status: 'scaffolded',
    category: 'devtool',
    path: 'parallel-execution-framework/frontend-dashhub/',
    stack: 'Frontend, Dashboard',
    description: 'Dashboard frontend for parallel execution framework.',
    revenueModel: 'Internal UI',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'payment-gateway-full',
    name: 'Payment Gateway (Full Suite)',
    status: 'built',
    category: 'platform',
    path: 'payment_gateway/',
    stack: 'Python, Flask, Stripe SDK, Auth middleware, Webhooks',
    description: 'Complete payment gateway with Stripe integration, webhooks, authentication, Postman collection.',
    revenueModel: 'Payment processing',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'ai-auditor-full',
    name: 'AI Auditor (Full Suite)',
    status: 'built',
    category: 'platform',
    path: 'ai-auditor/',
    stack: 'Next.js, Stripe, PayPal, Square, Webhooks, Electron',
    description: 'Complete AI website auditor with checkout (3 gateways), reports, scan API, webhooks, desktop Electron wrapper.',
    revenueModel: 'Audit service fees',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'hydi-pay-full',
    name: 'HydiPay (Complete)',
    status: 'built',
    category: 'platform',
    path: 'HydiPay/',
    stack: 'Python, Stripe, Webhooks, Checkout, Config',
    description: 'Complete payment system with Stripe integration, webhooks, checkout, branding, configuration guides.',
    revenueModel: 'Payment processing',
    marketable: true,
    topTen: true,
    section: 2,
  },
  {
    id: 'landing-pages-collection',
    name: 'Landing Pages Collection',
    status: 'built',
    category: 'devtool',
    path: 'landing_pages/',
    stack: 'HTML, JavaScript, GitHub Actions',
    description: 'Landing page collection with deployment automation and ProtoForge Industries page.',
    revenueModel: 'Marketing infrastructure',
    marketable: false,
    topTen: false,
    section: 7,
  },
  {
    id: 'api-router',
    name: 'API Router',
    status: 'built',
    category: 'devtool',
    path: 'api/agent-router.js',
    stack: 'Node.js, Vercel',
    description: 'Vercel API route handler for agent routing.',
    revenueModel: 'Infrastructure',
    marketable: false,
    topTen: false,
    section: 8,
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InventoryModule() {
  const [statusFilter, setStatusFilter] = useState<ItemStatus | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<ItemCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showMarketableOnly, setShowMarketableOnly] = useState(false);
  const [showTopTenOnly, setShowTopTenOnly] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    return INVENTORY.filter(item => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (showMarketableOnly && !item.marketable) return false;
      if (showTopTenOnly && !item.topTen) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.stack.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [statusFilter, categoryFilter, searchQuery, showMarketableOnly, showTopTenOnly]);

  const selectedItem = selected ? INVENTORY.find(i => i.id === selected) : null;

  const sections = useMemo(() => {
    const map = new Map<number, InventoryItem[]>();
    for (const item of filtered) {
      const list = map.get(item.section) || [];
      list.push(item);
      map.set(item.section, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [filtered]);

  const toggleSection = (s: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const statuses: ItemStatus[] = ['built', 'scaffolded', 'concept', 'landing'];
  const categories: ItemCategory[] = ['revenue-ready', 'platform', 'infrastructure', 'concept', 'venture', 'media', 'devtool'];

  const counts = {
    total: INVENTORY.length,
    built: INVENTORY.filter(i => i.status === 'built').length,
    marketable: INVENTORY.filter(i => i.marketable).length,
    topTen: INVENTORY.filter(i => i.topTen).length,
  };

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-editor)' }}>
      {/* Main List */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Package size={20} style={{ color: '#f0883e' }} />
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
                Master Inventory
              </h1>
              <span
                className="text-[11px] font-mono px-2 py-0.5 rounded"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}
              >
                {filtered.length} / {counts.total} items
              </span>
            </div>

            {/* Quick Stats */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono px-2 py-1 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
                {counts.built} built
              </span>
              <span className="text-[10px] font-mono px-2 py-1 rounded" style={{ background: '#d2992215', color: '#d29922' }}>
                {counts.marketable} marketable
              </span>
              <span className="text-[10px] font-mono px-2 py-1 rounded" style={{ background: '#f0883e15', color: '#f0883e' }}>
                {counts.topTen} top 10
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search apps, stacks, descriptions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded text-sm font-mono outline-none"
              style={{
                background: 'var(--bg-sidebar)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filters Row 1: Status */}
          <div className="flex items-center gap-2 mb-2">
            <Filter size={12} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Status:</span>
            {statuses.map(s => {
              const st = STATUS_STYLE[s];
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                  className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
                  style={{
                    background: statusFilter === s ? st.bg : 'var(--bg-sidebar)',
                    color: statusFilter === s ? st.color : 'var(--text-secondary)',
                    border: statusFilter === s ? `1px solid ${st.color}40` : '1px solid transparent',
                  }}
                >
                  {st.label}
                </button>
              );
            })}
          </div>

          {/* Filters Row 2: Category */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Filter size={12} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Type:</span>
            {categories.map(c => {
              const cs = CATEGORY_STYLE[c];
              return (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                  className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
                  style={{
                    background: categoryFilter === c ? cs.color + '15' : 'var(--bg-sidebar)',
                    color: categoryFilter === c ? cs.color : 'var(--text-secondary)',
                    border: categoryFilter === c ? `1px solid ${cs.color}40` : '1px solid transparent',
                  }}
                >
                  {cs.label}
                </button>
              );
            })}
          </div>

          {/* Filters Row 3: Toggles */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMarketableOnly(!showMarketableOnly)}
              className="text-[10px] font-mono px-2 py-1 rounded flex items-center gap-1 transition-colors"
              style={{
                background: showMarketableOnly ? '#3fb95015' : 'var(--bg-sidebar)',
                color: showMarketableOnly ? '#3fb950' : 'var(--text-secondary)',
                border: showMarketableOnly ? '1px solid #3fb95040' : '1px solid transparent',
              }}
            >
              <DollarSign size={10} /> Marketable Only
            </button>
            <button
              onClick={() => setShowTopTenOnly(!showTopTenOnly)}
              className="text-[10px] font-mono px-2 py-1 rounded flex items-center gap-1 transition-colors"
              style={{
                background: showTopTenOnly ? '#f0883e15' : 'var(--bg-sidebar)',
                color: showTopTenOnly ? '#f0883e' : 'var(--text-secondary)',
                border: showTopTenOnly ? '1px solid #f0883e40' : '1px solid transparent',
              }}
            >
              <Zap size={10} /> Top 10 Only
            </button>
            <button
              onClick={() => {
                setStatusFilter(null);
                setCategoryFilter(null);
                setSearchQuery('');
                setShowMarketableOnly(false);
                setShowTopTenOnly(false);
              }}
              className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Sections */}
        <div className="p-4">
          {sections.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                No items match your filters.
              </p>
            </div>
          )}

          {sections.map(([sectionNum, items]) => {
            const isCollapsed = collapsedSections.has(sectionNum);
            return (
              <div key={sectionNum} className="mb-4">
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(sectionNum)}
                  className="flex items-center gap-2 w-full text-left px-2 py-2 rounded transition-colors hover:bg-white/5"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                  ) : (
                    <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                  )}
                  <span className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                    {SECTION_LABELS[sectionNum] || `Section ${sectionNum}`}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    ({items.length})
                  </span>
                </button>

                {/* Items */}
                {!isCollapsed && (
                  <div className="space-y-1 ml-2">
                    {items.map(item => {
                      const st = STATUS_STYLE[item.status];
                      const cs = CATEGORY_STYLE[item.category];
                      const isSelected = selected === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelected(isSelected ? null : item.id)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer transition-all group"
                          style={{
                            background: isSelected ? 'var(--highlight)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--text-accent)' : '2px solid transparent',
                          }}
                        >
                          {/* Status dot */}
                          <Circle size={8} fill={st.color} stroke={st.color} className="shrink-0" />

                          {/* Name + description */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-active)' }}>
                                {item.name}
                              </span>
                              {item.topTen && (
                                <Zap size={10} className="shrink-0" style={{ color: '#f0883e' }} />
                              )}
                              {item.marketable && (
                                <DollarSign size={10} className="shrink-0" style={{ color: '#3fb950' }} />
                              )}
                            </div>
                            <p className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                              {item.description}
                            </p>
                          </div>

                          {/* Status badge */}
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: st.bg, color: st.color }}
                          >
                            {st.label}
                          </span>

                          {/* Category badge */}
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 hidden lg:inline"
                            style={{ background: cs.color + '15', color: cs.color }}
                          >
                            {cs.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedItem && (
        <div
          className="w-80 border-l overflow-y-auto p-4 shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers size={14} style={{ color: 'var(--text-accent)' }} />
              <span className="text-[11px] font-bold font-mono uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                Detail
              </span>
            </div>
            <button onClick={() => setSelected(null)} style={{ color: 'var(--text-secondary)' }}>
              <X size={14} />
            </button>
          </div>

          <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-active)' }}>
            {selectedItem.name}
          </h3>

          {selectedItem.topTen && (
            <div className="flex items-center gap-1 mb-2 px-2 py-1 rounded" style={{ background: '#f0883e15' }}>
              <Zap size={12} style={{ color: '#f0883e' }} />
              <span className="text-[10px] font-mono font-bold" style={{ color: '#f0883e' }}>TOP 10 — NEAREST TO MONEY</span>
            </div>
          )}

          <p className="text-[11px] mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {selectedItem.description}
          </p>

          <div className="space-y-3 text-[11px] font-mono">
            {/* Status */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Status: </span>
              <span
                className="px-1.5 py-0.5 rounded"
                style={{
                  color: STATUS_STYLE[selectedItem.status].color,
                  background: STATUS_STYLE[selectedItem.status].bg,
                }}
              >
                {STATUS_STYLE[selectedItem.status].label}
              </span>
            </div>

            {/* Category */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Category: </span>
              <span style={{ color: CATEGORY_STYLE[selectedItem.category].color }}>
                {CATEGORY_STYLE[selectedItem.category].label}
              </span>
            </div>

            {/* Path */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Path: </span>
              <span className="break-all" style={{ color: 'var(--text-primary)' }}>
                {selectedItem.path}
              </span>
            </div>

            {/* Stack */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Stack: </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {selectedItem.stack.split(', ').map((tech, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[9px]"
                    style={{ background: 'var(--bg-editor)', color: 'var(--text-primary)' }}
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* Revenue Model */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Revenue Model: </span>
              <p className="mt-1 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {selectedItem.revenueModel}
              </p>
            </div>

            {/* Marketable */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Marketable: </span>
              <span style={{ color: selectedItem.marketable ? '#3fb950' : 'var(--text-secondary)' }}>
                {selectedItem.marketable ? 'Yes' : 'No'}
              </span>
            </div>

            {/* Section */}
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Section: </span>
              <span style={{ color: 'var(--text-primary)' }}>
                {SECTION_LABELS[selectedItem.section]}
              </span>
            </div>

            {/* Action Items */}
            {selectedItem.actionItems && selectedItem.actionItems.length > 0 && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={12} style={{ color: '#f0883e' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#f0883e' }}>
                    Action Items ({selectedItem.actionItems.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {selectedItem.actionItems.map((action, index) => (
                    <div
                      key={action.id}
                      className="p-2 rounded border"
                      style={{
                        borderColor: action.priority === 'high' ? '#f85149' :
                          action.priority === 'medium' ? '#d29922' : '#58a6ff',
                        background: action.priority === 'high' ? '#f8514915' :
                          action.priority === 'medium' ? '#d2992215' : '#58a6ff15',
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-active)' }}>
                          {action.title}
                        </span>
                        <div className="flex items-center gap-1">
                          <span
                            className="text-[8px] px-1 py-0.5 rounded"
                            style={{
                              background: action.priority === 'high' ? '#f85149' :
                                action.priority === 'medium' ? '#d29922' : '#58a6ff',
                              color: 'white',
                            }}
                          >
                            {action.priority}
                          </span>
                          <span
                            className="text-[8px] px-1 py-0.5 rounded"
                            style={{
                              background: action.assignee === 'jordan' ? '#a855f7' :
                                action.assignee === 'hydi' ? '#3b82f6' : '#22c55e',
                              color: 'white',
                            }}
                          >
                            {action.assignee}
                          </span>
                        </div>
                      </div>
                      <p className="text-[9px] leading-relaxed mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {action.description}
                      </p>
                      <div className="flex items-center gap-2 text-[8px]" style={{ color: 'var(--text-secondary)' }}>
                        <span>⏱️ {action.estimatedTime}</span>
                        <span>•</span>
                        <span
                          className="px-1 py-0.5 rounded"
                          style={{
                            background: action.status === 'completed' ? '#3fb950' :
                              action.status === 'in-progress' ? '#d29922' : '#8b949e',
                            color: 'white',
                          }}
                        >
                          {action.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
