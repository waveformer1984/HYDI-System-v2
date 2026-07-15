// URSULA CROSS-CHECK + MONETIZATION REFERENCE SHEET (UCMRS) TYPES
// No fluff, just brutal reality in TypeScript

export type ComponentCategory = 'Sensor' | 'MCU' | 'Power' | 'Audio' | 'Motion' | 'Structure' | 'Interface';
export type PhysicalStatus = 'Not Acquired' | 'Acquired' | 'Mounted' | 'Wired' | 'Tested';
export type UrsulaStatus = 'Not Registered' | 'Registered' | 'Addressable' | 'Streaming Data' | 'Controlled';
export type Protocol = 'I2C' | 'SPI' | 'UART' | 'Analog' | 'MIDI' | 'Custom';
export type FailureRiskLevel = 'Low' | 'Medium' | 'High' | 'this will absolutely break at demo';
export type MonetizationClass = 'Core Product' | 'Feature' | 'Add-on' | 'Internal Only' | 'Licensing Candidate';
export type RevenuePath = 'Direct Sale' | 'Subscription' | 'Data Service' | 'Licensing' | 'Bundled';
export type ValidationStatus = 'Not Verified' | 'Bench Verified' | 'System Verified' | 'Demo Ready';

export interface Component {
  id: string;
  component_id: string;
  module_name: string;
  category: ComponentCategory;
  physical_status: PhysicalStatus;
  ursula_status: UrsulaStatus;
  input_type?: string;
  output_type?: string;
  protocol?: Protocol;
  update_rate?: number; // Hz
  requires: string[]; // Component IDs
  feeds: string[]; // Component IDs
  failure_risk_level: FailureRiskLevel;
  monetization_class: MonetizationClass;
  revenue_path: RevenuePath;
  validation_status: ValidationStatus;
  
  // Reality Filter - The brutal truth
  solves_real_problem: boolean;
  would_pay_today: boolean;
  can_demo_60_seconds: boolean;
  
  created_at: string;
  updated_at: string;
  last_verified?: string;
}

export interface Protoboard {
  id: string;
  board_id: string;
  linked_components: string[];
  voltage_stable: boolean;
  current_draw_logged: boolean;
  noise_level: 'Low' | 'Med' | 'High';
  crosstalk_risk: boolean;
  connection_map_documented: boolean;
  detected: boolean;
  address_stable: boolean;
  failure_points: string[];
  next_action: 'Stabilize' | 'Replace' | 'Integrate' | 'Kill it';
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: string;
  module_name: string;
  level_0_count: number;
  level_1_count: number;
  level_2_count: number;
  level_3_count: number;
  level_4_count: number;
  level_5_count: number;
  stability_score: number; // 0-10
  monetization_readiness: number; // 0-10
  critical_gaps: string[];
  fastest_revenue_path: string;
  upgrade_path: string;
  kill_criteria: string;
  created_at: string;
  updated_at: string;
}

export interface CrossCheckAlert {
  id: string;
  component_id: string;
  alert_type: string;
  message: string;
  severity: 'Info' | 'Warning' | 'Critical' | 'Demo Risk';
  status: 'Open' | 'Acknowledged' | 'Resolved' | 'Ignored';
  created_at: string;
  resolved_at?: string;
}

export interface IntegrationAudit {
  id: string;
  component_id: string;
  previous_level: string;
  new_level: string;
  changed_by: string;
  notes: string;
  created_at: string;
}

export interface ComponentSummary {
  component_id: string;
  module_name: string;
  category: ComponentCategory;
  physical_status: PhysicalStatus;
  ursula_status: UrsulaStatus;
  monetization_class: MonetizationClass;
  validation_status: ValidationStatus;
  integration_level: number; // 0-4 based on ursula_status
  reality_classification: 'Product' | 'R&D';
  open_alerts: number;
}

export interface ModuleHealth {
  module_name: string;
  stability_score: number;
  monetization_readiness: number;
  total_components: number;
  controllable_components: number;
  demo_ready_components: number;
  open_alerts: number;
}

// Integration Levels - Stop treating "connected" as binary
export const INTEGRATION_LEVELS = {
  0: 'Exists physically (congrats)',
  1: 'Registered in Ursula',
  2: 'Data visible',
  3: 'Controllable',
  4: 'Automated behavior',
  5: 'Monetizable feature'
} as const;

// Monetization Decision Grid - Humans buy the same five things forever
export const MONETIZATION_DECISION_GRID = {
  'Sensors': ['Data product', 'analytics'],
  'Audio systems': ['Core product', 'feature'],
  'Motion systems': ['Premium feature'],
  'Power systems': ['Reliability upsell'],
  'AI / control logic': ['Subscription'],
  'Structural design': ['Licensing']
} as const;

// Cross-Check Rules - Make Ursula annoying like a project manager
export interface CrossCheckRule {
  condition: (component: Component) => boolean;
  alert_type: string;
  message: string;
  severity: 'Info' | 'Warning' | 'Critical' | 'Demo Risk';
}

export const CROSS_CHECK_RULES: CrossCheckRule[] = [
  {
    condition: (c) => c.physical_status !== 'Tested',
    alert_type: 'NON_VALIDATED_HARDWARE',
    message: 'Non-validated hardware - this will break at demo',
    severity: 'Critical'
  },
  {
    condition: (c) => !['Addressable', 'Streaming Data', 'Controlled'].includes(c.ursula_status),
    alert_type: 'INTEGRATION_GAP',
    message: 'Integration gap - component not addressable',
    severity: 'Warning'
  },
  {
    condition: (c) => !c.input_type || !c.output_type || !c.protocol,
    alert_type: 'UNDEFINED_BEHAVIOR',
    message: 'Undefined behavior - data profile incomplete',
    severity: 'Warning'
  },
  {
    condition: (c) => !c.monetization_class,
    alert_type: 'NO_REVENUE_PATH',
    message: 'No revenue path - this is a hobby, not a product',
    severity: 'Critical'
  },
  {
    condition: (c) => c.failure_risk_level === 'High' || c.failure_risk_level === 'this will absolutely break at demo',
    alert_type: 'DEMO_RISK',
    message: 'Demo risk - this component will fail publicly',
    severity: 'Demo Risk'
  },
  {
    condition: (c) => !c.solves_real_problem || !c.would_pay_today || !c.can_demo_60_seconds,
    alert_type: 'REALITY_FILTER',
    message: 'Reality filter failed - this is R&D, not a product',
    severity: 'Warning'
  }
];

// API Request/Response types
export interface CreateComponentRequest {
  component_id: string;
  module_name: string;
  category: ComponentCategory;
  monetization_class: MonetizationClass;
  revenue_path: RevenuePath;
  solves_real_problem: boolean;
  would_pay_today: boolean;
  can_demo_60_seconds: boolean;
}

export interface UpdateComponentRequest {
  physical_status?: PhysicalStatus;
  ursula_status?: UrsulaStatus;
  input_type?: string;
  output_type?: string;
  protocol?: Protocol;
  update_rate?: number;
  requires?: string[];
  feeds?: string[];
  failure_risk_level?: FailureRiskLevel;
  validation_status?: ValidationStatus;
  solves_real_problem?: boolean;
  would_pay_today?: boolean;
  can_demo_60_seconds?: boolean;
}

export interface CreateProtoboardRequest {
  board_id: string;
  linked_components: string[];
  voltage_stable: boolean;
  current_draw_logged: boolean;
  noise_level: 'Low' | 'Med' | 'High';
  crosstalk_risk: boolean;
  connection_map_documented: boolean;
  detected: boolean;
  address_stable: boolean;
  failure_points: string[];
}

export interface CrossCheckResponse {
  alerts: CrossCheckAlert[];
  summary: {
    total_components: number;
    critical_issues: number;
    demo_risks: number;
    monetization_ready: number;
    reality_products: number;
  };
}
