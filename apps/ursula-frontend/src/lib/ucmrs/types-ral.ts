// REVENUE ACTIVATION LAYER (RAL) TYPES
// From diagnostic to prescriptive monetization

export interface ProductCandidate {
  id: string;
  product_id: string;
  core_function: string;
  target_user: string;
  problem_solved: string; // 1 sentence, no poetry
  included_components: string[]; // Component IDs
  demo_method: string; // What can be shown in 60 seconds
  price_tier: '$' | '$$' | '$$$';
  revenue_model: 'One-time' | 'Subscription' | 'Hybrid';
  status: 'Candidate' | 'In Development' | 'Demo Ready' | 'Priced' | 'Offer Page' | 'Testing Sales' | 'Live' | 'Killed';

  // Revenue tracking
  time_to_first_dollar: number; // Days from creation
  actual_first_dollar_days?: number;
  total_revenue: number;
  units_sold: number;

  // Metadata
  created_at: string;
  updated_at: string;
  source_module: string;
}

export interface RevenueTrigger {
  id: string;
  trigger_type: 'BUILD_DEMO' | 'ASSIGN_PRICE' | 'GENERATE_OFFER_PAGE' | 'TEST_SALE';
  component_id?: string;
  product_id?: string;
  condition_met: boolean;
  triggered_at: string;
  resolved_at?: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Skipped';
  requirements: string[];
  next_action: string;
  urgency: 'Low' | 'Medium' | 'High' | 'Critical';
}

export interface BusinessDirection {
  module_name: string;
  direction: string;
  fast_money: string;
  long_game: string;
  priority: 'Focus Now' | 'Secondary' | 'Future' | 'Archive';
  time_to_first_dollar_target: number; // Days
  current_components: number;
  level_3_plus_components: number;
  readiness_score: number; // 0-10
}

export interface MonetizationSprint {
  id: string;
  sprint_number: number;
  start_date: string;
  end_date: string;
  status: 'Planning' | 'Active' | 'Completed' | 'Failed';

  // Week tracking
  week_1_focus: string;
  week_2_focus: string;
  week_3_focus: string;
  week_4_focus: string;

  // Target product
  target_product_id: string;
  target_revenue: number;
  actual_revenue: number;

  // Results
  sales_attempted: number;
  sales_completed: number;
  lessons_learned: string[];
  next_steps: string[];
}

export interface RevenueActivationState {
  total_components: number;
  level_3_plus_components: number;
  product_candidates: number;
  active_triggers: number;
  days_to_first_dollar_avg: number;
  sprint_status: string;

  // Brutal metrics
  time_wasters: number;
  actual_products: number;
  revenue_generating: number;

  // Prescriptive actions
  immediate_actions: string[];
  week_focus: string;
  month_target: string;
}

// Business Direction Templates
export const BUSINESS_DIRECTIONS: Record<string, BusinessDirection> = {
  'Audio / Synth / Control Systems': {
    module_name: 'Audio / Synth / Control Systems',
    direction: 'Creative hardware + software hybrid',
    fast_money: 'MIDI tools, sound packs, performance devices',
    long_game: 'Subscription ecosystem (presets, expansions)',
    priority: 'Focus Now',
    time_to_first_dollar_target: 14,
    current_components: 0,
    level_3_plus_components: 0,
    readiness_score: 0
  },
  'Motion / Rail / Mechanical Systems': {
    module_name: 'Motion / Rail / Mechanical Systems',
    direction: 'Licensing + niche hardware',
    fast_money: 'Kits / specialty builds',
    long_game: 'Sell designs, not units',
    priority: 'Secondary',
    time_to_first_dollar_target: 30,
    current_components: 0,
    level_3_plus_components: 0,
    readiness_score: 0
  },
  'Power / Experimental Systems': {
    module_name: 'Power / Experimental Systems',
    direction: 'Internal advantage',
    fast_money: 'Cost reduction',
    long_game: 'Higher margins',
    priority: 'Future',
    time_to_first_dollar_target: 90,
    current_components: 0,
    level_3_plus_components: 0,
    readiness_score: 0
  },
  'Ursula (Control + Intelligence Layer)': {
    module_name: 'Ursula (Control + Intelligence Layer)',
    direction: 'Subscription platform',
    fast_money: 'Internal tool (saves you time)',
    long_game: 'Sell as "system control + validation layer"',
    priority: 'Focus Now',
    time_to_first_dollar_target: 21,
    current_components: 0,
    level_3_plus_components: 0,
    readiness_score: 0
  }
};

// Revenue Trigger Logic
export interface TriggerCondition {
  check: (components: any[], products: ProductCandidate[]) => boolean;
  trigger_type: RevenueTrigger['trigger_type'];
  requirements: string[];
  next_action: string;
  urgency: RevenueTrigger['urgency'];
}

export const REVENUE_TRIGGERS: TriggerCondition[] = [
  {
    check: (components) => components.filter(c => getIntegrationLevel(c.ursula_status) >= 3).length >= 1,
    trigger_type: 'BUILD_DEMO',
    requirements: ['Component controllable', 'Basic functionality verified', '60-second demo possible'],
    next_action: 'Create demo script and record video',
    urgency: 'High'
  },
  {
    check: (components, products) => products.some(p => p.status === 'Demo Ready'),
    trigger_type: 'ASSIGN_PRICE',
    requirements: ['Demo exists', 'Value proposition clear', 'Competitive research done'],
    next_action: 'Set price tier and revenue model',
    urgency: 'High'
  },
  {
    check: (components, products) => products.some(p => p.status === 'Priced'),
    trigger_type: 'GENERATE_OFFER_PAGE',
    requirements: ['Price assigned', 'Product description written', 'Demo video ready'],
    next_action: 'Build landing page with payment integration',
    urgency: 'Medium'
  },
  {
    check: (components, products) => products.some(p => p.status === 'Offer Page'),
    trigger_type: 'TEST_SALE',
    requirements: ['Offer page live', 'Payment processing working', 'Demo accessible'],
    next_action: 'Attempt first 10 sales',
    urgency: 'Critical'
  }
];

// Helper functions
function getIntegrationLevel(ursulaStatus: string): number {
  const levelMap: Record<string, number> = {
    'Not Registered': 0,
    'Registered': 1,
    'Addressable': 2,
    'Streaming Data': 2,
    'Controlled': 3,
    'Automated': 4,
    'Monetizable': 5
  };
  return levelMap[ursulaStatus] || 0;
}

// Product Collapse Logic
export interface ProductCollapseRequest {
  module_name: string;
  components: string[]; // Component IDs to bundle
  core_function: string;
  target_user: string;
  problem_solved: string;
  demo_method: string;
}

// Sprint Templates
export const SPRINT_TEMPLATE: Omit<MonetizationSprint, 'id' | 'sprint_number' | 'start_date' | 'end_date' | 'status' | 'target_product_id' | 'target_revenue' | 'actual_revenue' | 'sales_attempted' | 'sales_completed' | 'lessons_learned' | 'next_steps'> = {
  week_1_focus: 'Identify module with highest Level 3 density, force into product definition, build demo',
  week_2_focus: 'Assign price, create simple landing page, record demo video',
  week_3_focus: 'Attempt 10 sales (yes, attempt, not "prepare to attempt someday")',
  week_4_focus: 'Evaluate: Bought? expand. Ignored? reposition. Confusing? simplify'
};

// API Request/Response types
export interface CreateProductRequest {
  product_id: string;
  core_function: string;
  target_user: string;
  problem_solved: string;
  included_components: string[];
  demo_method: string;
  price_tier: '$' | '$$' | '$$$';
  revenue_model: 'One-time' | 'Subscription' | 'Hybrid';
}

export interface UpdateProductRequest {
  status?: ProductCandidate['status'];
  demo_method?: string;
  price_tier?: '$' | '$$' | '$$$';
  revenue_model?: 'One-time' | 'Subscription' | 'Hybrid';
  total_revenue?: number;
  units_sold?: number;
}

export interface CreateSprintRequest {
  target_product_id: string;
  target_revenue: number;
  start_date?: string;
}
