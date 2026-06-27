/**
 * Colters Smokehouse & Cultures - Shared Types
 * 
 * Centralized type definitions for both smokehouse operations
 * and cultures management systems.
 */

// ==================== SMOKEHOUSE TYPES ====================

export type ProductStatus = 'available' | 'smoking' | 'curing' | 'out_of_stock' | 'discontinued';
export type ProductCategory = 'beef' | 'pork' | 'poultry' | 'lamb' | 'fish' | 'specialty' | 'sides' | 'sauces';
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type SmokingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cooling' | 'finished';
export type ComplianceType = 'health_inspection' | 'food_safety' | 'temperature_log' | 'cleaning';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  status: ProductStatus;
  price: number;
  weight: number; // in lbs
  description: string;
  smokingTime: number; // in hours
  woodType: string;
  spiceRub: string;
  inventory: number;
  minOrder: number;
  maxOrder: number;
  allergens: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  type: 'retail' | 'wholesale' | 'restaurant';
  notes: string;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
  orderDate: string;
  deliveryDate: string;
  deliveryMethod: 'pickup' | 'delivery' | 'shipping';
  notes: string;
  paymentStatus: 'paid' | 'pending' | 'refunded';
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
  notes?: string;
}

export interface SmokingSchedule {
  id: string;
  productId: string;
  quantity: number;
  startTime: string;
  endTime: string;
  status: SmokingStatus;
  temperature: number;
  humidity?: number;
  woodType: string;
  notes: string;
  smoker: string;
}

export interface ComplianceRecord {
  id: string;
  type: ComplianceType;
  date: string;
  status: 'pass' | 'fail' | 'pending';
  inspector?: string;
  notes: string;
  nextDue: string;
}

// ==================== CULTURES TYPES ====================

export type CultureStatus = 'active' | 'dormant' | 'contaminated' | 'expired' | 'preparing' | 'fermenting';
export type CultureCategory = 'starter' | 'brine' | 'rub' | 'sauce' | 'pickle' | 'cure' | 'marinade' | 'injection';
export type FermentationStage = 'initial' | 'active' | 'peak' | 'declining' | 'complete';
export type MeasurementType = 'ph' | 'temperature' | 'salinity' | 'brix' | 'specific_gravity' | 'acidity';

export interface Culture {
  id: string;
  name: string;
  category: CultureCategory;
  status: CultureStatus;
  description: string;
  origin: string;
  source: string;
  acquisitionDate: string;
  expirationDate: string;
  storageConditions: string;
  optimalTemp: number; // Fahrenheit
  optimalPh: number;
  currentPh?: number;
  currentTemp?: number;
  ingredients: string[];
  allergens: string[];
  usage: string[];
  yield: string;
  preparationTime: number; // in hours
  fermentationTime: number; // in hours
  notes: string;
  isActive: boolean;
  batchCount: number;
  successRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface FermentationBatch {
  id: string;
  cultureId: string;
  batchName: string;
  status: FermentationStage;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string;
  initialPh: number;
  currentPh: number;
  targetPh: number;
  temperature: number;
  humidity?: number;
  vessel: string;
  volume: number; // in liters
  ingredients: BatchIngredient[];
  measurements: Measurement[];
  notes: string;
  success: boolean;
  yield: string;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  issues: string[];
  createdAt: string;
}

export interface BatchIngredient {
  name: string;
  amount: number;
  unit: string;
  type: 'base' | 'culture' | 'additive' | 'flavor';
}

export interface Measurement {
  timestamp: string;
  type: MeasurementType;
  value: number;
  unit: string;
  notes?: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: CultureCategory;
  description: string;
  cultureId?: string;
  prepTime: number; // minutes
  fermentTime: number; // hours
  difficulty: 'easy' | 'medium' | 'hard';
  servings: number;
  ingredients: RecipeIngredient[];
  instructions: string[];
  tips: string[];
  variations: string[];
  storage: string;
  shelfLife: string;
  rating: number;
  reviews: number;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  name: string;
  amount: number;
  unit: string;
  notes?: string;
  optional: boolean;
}

export interface CultureLog {
  id: string;
  cultureId: string;
  batchId?: string;
  action: 'created' | 'fed' | 'split' | 'harvested' | 'discarded' | 'contaminated' | 'tested';
  timestamp: string;
  details: string;
  performedBy: string;
  notes: string;
  attachments: string[];
}
