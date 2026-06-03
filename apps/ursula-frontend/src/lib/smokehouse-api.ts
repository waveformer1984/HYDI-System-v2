/**
 * Colters Smokehouse API Endpoints Structure
 * 
 * Complete API structure for smokehouse operations and cultures management.
 * Ready for FastAPI/Express implementation with proper error handling,
 * validation, and authentication.
 * 
 * Usage: Implement these endpoints in your preferred backend framework.
 * Security: Add JWT authentication and rate limiting as needed.
 */

// Import centralized types
import type {
  Product,
  ProductCategory,
  ProductStatus,
  Order,
  OrderStatus,
  SmokingStatus,
  ComplianceRecord,
  ComplianceType,
  Customer,
  OrderItem,
  SmokingSchedule,
  Culture,
  CultureCategory,
  CultureStatus,
  FermentationBatch,
  FermentationStage,
  Recipe,
  RecipeIngredient,
  CultureLog,
  Measurement,
  BatchIngredient,
  MeasurementType,
} from '@/types/smokehouse';

// Base URL: /api/v1/smokehouse

// ==================== PRODUCTS ====================

// GET /api/v1/smokehouse/products
// Get all products with optional filtering
interface GetProductsQuery {
  category?: 'beef' | 'pork' | 'poultry' | 'lamb' | 'fish' | 'specialty' | 'sides' | 'sauces';
  status?: 'available' | 'smoking' | 'curing' | 'out_of_stock' | 'discontinued';
  search?: string;
  page?: number;
  limit?: number;
}

interface GetProductsResponse {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

// POST /api/v1/smokehouse/products
// Create new product
interface CreateProductRequest {
  name: string;
  category: ProductCategory;
  price: number;
  weight: number;
  description: string;
  smokingTime: number;
  woodType: string;
  spiceRub: string;
  inventory: number;
  minOrder: number;
  maxOrder: number;
  allergens: string[];
}

// PUT /api/v1/smokehouse/products/:id
// Update existing product
interface UpdateProductRequest extends Partial<CreateProductRequest> {
  status?: ProductStatus;
}

// DELETE /api/v1/smokehouse/products/:id
// Delete product

// GET /api/v1/smokehouse/products/:id
// Get single product details

// ==================== CUSTOMERS ====================

// GET /api/v1/smokehouse/customers
interface GetCustomersQuery {
  type?: 'retail' | 'wholesale' | 'restaurant';
  search?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/smokehouse/customers
interface CreateCustomerRequest {
  name: string;
  email: string;
  phone: string;
  address: string;
  type: 'retail' | 'wholesale' | 'restaurant';
  notes?: string;
}

// PUT /api/v1/smokehouse/customers/:id
// DELETE /api/v1/smokehouse/customers/:id
// GET /api/v1/smokehouse/customers/:id

// ==================== ORDERS ====================

// GET /api/v1/smokehouse/orders
interface GetOrdersQuery {
  customerId?: string;
  status?: OrderStatus;
  paymentStatus?: 'paid' | 'pending' | 'refunded';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/smokehouse/orders
interface CreateOrderRequest {
  customerId: string;
  items: {
    productId: string;
    quantity: number;
    notes?: string;
  }[];
  deliveryDate: string;
  deliveryMethod: 'pickup' | 'delivery' | 'shipping';
  notes?: string;
}

// PUT /api/v1/smokehouse/orders/:id
interface UpdateOrderRequest {
  status?: OrderStatus;
  paymentStatus?: 'paid' | 'pending' | 'refunded';
  notes?: string;
}

// DELETE /api/v1/smokehouse/orders/:id
// GET /api/v1/smokehouse/orders/:id

// ==================== SMOKING SCHEDULES ====================

// GET /api/v1/smokehouse/schedules
interface GetSchedulesQuery {
  productId?: string;
  status?: SmokingStatus;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/smokehouse/schedules
interface CreateScheduleRequest {
  productId: string;
  quantity: number;
  startTime: string;
  endTime: string;
  temperature: number;
  humidity?: number;
  woodType: string;
  smoker: string;
  notes?: string;
}

// PUT /api/v1/smokehouse/schedules/:id
interface UpdateScheduleRequest {
  status?: SmokingStatus;
  currentTemp?: number;
  currentPh?: number;
  notes?: string;
}

// DELETE /api/v1/smokehouse/schedules/:id
// GET /api/v1/smokehouse/schedules/:id

// POST /api/v1/smokehouse/schedules/:id/measurements
interface AddMeasurementRequest {
  type: 'temperature' | 'ph' | 'humidity';
  value: number;
  notes?: string;
}

// ==================== COMPLIANCE ====================

// GET /api/v1/smokehouse/compliance
interface GetComplianceQuery {
  type?: 'health_inspection' | 'food_safety' | 'temperature_log' | 'cleaning';
  status?: 'pass' | 'fail' | 'pending';
  startDate?: string;
  endDate?: string;
}

// POST /api/v1/smokehouse/compliance
interface CreateComplianceRecordRequest {
  type: ComplianceType;
  date: string;
  status: 'pass' | 'fail' | 'pending';
  inspector?: string;
  notes: string;
  nextDue: string;
  attachments?: string[];
}

// PUT /api/v1/smokehouse/compliance/:id
// DELETE /api/v1/smokehouse/compliance/:id
// GET /api/v1/smokehouse/compliance/:id

// ==================== CULTURES API ====================
// Base URL: /api/v1/cultures

// GET /api/v1/cultures/cultures
interface GetCulturesQuery {
  category?: CultureCategory;
  status?: CultureStatus;
  search?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/cultures/cultures
interface CreateCultureRequest {
  name: string;
  category: CultureCategory;
  description: string;
  origin: string;
  source: string;
  optimalTemp: number;
  optimalPh: number;
  ingredients: string[];
  allergens: string[];
  usage: string[];
  yield: string;
  preparationTime: number;
  fermentationTime: number;
  storageConditions: string;
  notes?: string;
}

// PUT /api/v1/cultures/cultures/:id
// DELETE /api/v1/cultures/cultures/:id
// GET /api/v1/cultures/cultures/:id

// POST /api/v1/cultures/cultures/:id/measurements
interface AddCultureMeasurementRequest {
  type: 'ph' | 'temperature' | 'salinity' | 'brix' | 'specific_gravity' | 'acidity';
  value: number;
  unit: string;
  notes?: string;
}

// ==================== FERMENTATION BATCHES ====================

// GET /api/v1/cultures/batches
interface GetBatchesQuery {
  cultureId?: string;
  status?: FermentationStage;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/cultures/batches
interface CreateBatchRequest {
  cultureId: string;
  batchName: string;
  expectedEndDate: string;
  initialPh: number;
  temperature: number;
  humidity?: number;
  vessel: string;
  volume: number;
  ingredients: {
    name: string;
    amount: number;
    unit: string;
    type: 'base' | 'culture' | 'additive' | 'flavor';
  }[];
  notes?: string;
}

// PUT /api/v1/cultures/batches/:id
interface UpdateBatchRequest {
  status?: FermentationStage;
  currentPh?: number;
  temperature?: number;
  humidity?: number;
  notes?: string;
  success?: boolean;
  yield?: string;
  quality?: 'excellent' | 'good' | 'fair' | 'poor';
  issues?: string[];
}

// DELETE /api/v1/cultures/batches/:id
// GET /api/v1/cultures/batches/:id

// ==================== RECIPES ====================

// GET /api/v1/cultures/recipes
interface GetRecipesQuery {
  category?: CultureCategory;
  cultureId?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  search?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/cultures/recipes
interface CreateRecipeRequest {
  name: string;
  category: CultureCategory;
  description: string;
  cultureId?: string;
  prepTime: number;
  fermentTime: number;
  difficulty: 'easy' | 'medium' | 'hard';
  servings: number;
  ingredients: {
    name: string;
    amount: number;
    unit: string;
    notes?: string;
    optional: boolean;
  }[];
  instructions: string[];
  tips?: string[];
  variations?: string[];
  storage: string;
  shelfLife: string;
}

// PUT /api/v1/cultures/recipes/:id
// DELETE /api/v1/cultures/recipes/:id
// GET /api/v1/cultures/recipes/:id

// POST /api/v1/cultures/recipes/:id/reviews
interface AddRecipeReviewRequest {
  rating: number; // 1-5
  review: string;
}

// ==================== ACTIVITY LOGS ====================

// GET /api/v1/cultures/logs
interface GetLogsQuery {
  cultureId?: string;
  batchId?: string;
  action?: 'created' | 'fed' | 'split' | 'harvested' | 'discarded' | 'contaminated' | 'tested';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// POST /api/v1/cultures/logs
interface CreateLogRequest {
  cultureId: string;
  batchId?: string;
  action: 'created' | 'fed' | 'split' | 'harvested' | 'discarded' | 'contaminated' | 'tested';
  details: string;
  notes?: string;
  attachments?: string[];
}

// ==================== DASHBOARD & ANALYTICS ====================

// GET /api/v1/smokehouse/dashboard
interface GetDashboardResponse {
  summary: {
    totalProducts: number;
    activeProducts: number;
    totalCustomers: number;
    pendingOrders: number;
    activeSmokingSchedules: number;
  };
  recentOrders: Order[];
  lowInventoryProducts: Product[];
  upcomingCompliance: ComplianceRecord[];
}

// GET /api/v1/cultures/dashboard
interface GetCulturesDashboardResponse {
  summary: {
    totalCultures: number;
    activeCultures: number;
    activeBatches: number;
    totalRecipes: number;
  };
  recentBatches: FermentationBatch[];
  culturesNeedingAttention: Culture[];
  upcomingTasks: CultureLog[];
}

// GET /api/v1/analytics/sales
interface GetSalesAnalyticsQuery {
  startDate: string;
  endDate: string;
  groupBy?: 'day' | 'week' | 'month';
}

// GET /api/v1/analytics/production
interface GetProductionAnalyticsQuery {
  startDate: string;
  endDate: string;
  productId?: string;
}

// ==================== WEBHOOKS ====================

// POST /api/v1/webhooks/smokehouse-updates
// POST /api/v1/webhooks/cultures-alerts
// POST /api/v1/webhooks/compliance-reminders

export type {
  // Smokehouse
  GetProductsQuery,
  GetProductsResponse,
  CreateProductRequest,
  UpdateProductRequest,
  GetCustomersQuery,
  CreateCustomerRequest,
  GetOrdersQuery,
  CreateOrderRequest,
  UpdateOrderRequest,
  GetSchedulesQuery,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  AddMeasurementRequest,
  GetComplianceQuery,
  CreateComplianceRecordRequest,

  // Cultures
  GetCulturesQuery,
  CreateCultureRequest,
  AddCultureMeasurementRequest,
  GetBatchesQuery,
  CreateBatchRequest,
  UpdateBatchRequest,
  GetRecipesQuery,
  CreateRecipeRequest,
  AddRecipeReviewRequest,
  GetLogsQuery,
  CreateLogRequest,

  // Dashboard
  GetDashboardResponse,
  GetCulturesDashboardResponse,
  GetSalesAnalyticsQuery,
  GetProductionAnalyticsQuery,
};
