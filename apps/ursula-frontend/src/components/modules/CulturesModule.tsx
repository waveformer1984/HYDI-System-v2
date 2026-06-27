/**
 * CulturesModule — Colters Cultural Management and Tracking System
 * 
 * Complete management system for food cultures, fermentation, and
 * preservation techniques used in Colters operations.
 * Features culture tracking, fermentation schedules, pH monitoring,
 * and recipe management for various cultured products.
 * 
 * Config: Replace mock data with API integration when ready.
 * Error handling: Empty states and validation for all forms.
 */
'use client';

import { useState, useMemo } from 'react';
import {
  Microscope,
  Beaker,
  Clock,
  TrendingUp,
  Calendar,
  Thermometer,
  AlertTriangle,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Filter,
  Search,
  ChefHat,
  Timer,
  FileText,
  BarChart3,
  Settings,
  BeakerIcon,
  Droplets,
  Activity,
  RefreshCw,
  Download,
  Upload,
  Eye,
  EyeOff,
  Save,
  X,
  Zap,
  Target,
  Award,
  Heart,
  Brain,
  Sparkles,
  GitBranch,
  Layers,
  Package,
  Star,
  MapPin,
  Scale,
  ClipboardList,
  Circle,
  Play,
  TrendingDown,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CultureStatus = 'active' | 'dormant' | 'contaminated' | 'expired' | 'preparing' | 'fermenting';
type CultureCategory = 'starter' | 'brine' | 'rub' | 'sauce' | 'pickle' | 'cure' | 'marinade' | 'injection';
type FermentationStage = 'initial' | 'active' | 'peak' | 'declining' | 'complete';
type MeasurementType = 'ph' | 'temperature' | 'salinity' | 'brix' | 'specific_gravity' | 'acidity';

interface Culture {
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

interface FermentationBatch {
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

interface BatchIngredient {
  name: string;
  amount: number;
  unit: string;
  type: 'base' | 'culture' | 'additive' | 'flavor';
}

interface Measurement {
  timestamp: string;
  type: MeasurementType;
  value: number;
  unit: string;
  notes?: string;
}

interface Recipe {
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

interface RecipeIngredient {
  name: string;
  amount: number;
  unit: string;
  notes?: string;
  optional: boolean;
}

interface CultureLog {
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

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_CULTURES: Culture[] = [
  {
    id: '1',
    name: 'San Francisco Sourdough Starter',
    category: 'starter',
    status: 'active',
    description: 'Classic San Francisco sourdough starter with distinctive tangy flavor',
    origin: 'San Francisco, CA',
    source: 'Bouchon Bakery',
    acquisitionDate: '2024-01-15',
    expirationDate: '2025-01-15',
    storageConditions: 'Glass jar, loosely covered, room temperature',
    optimalTemp: 75,
    optimalPh: 3.8,
    currentPh: 3.9,
    currentTemp: 72,
    ingredients: ['Flour', 'Water', 'Wild yeast', 'Lactobacillus'],
    allergens: ['Wheat'],
    usage: ['Bread', 'Pancakes', 'Waffles', 'Pizza dough'],
    yield: '1 cup starter feeds 3-4 cups flour',
    preparationTime: 4,
    fermentationTime: 12,
    notes: 'Feed every 12 hours when active. Can be refrigerated for up to a week without feeding.',
    isActive: true,
    batchCount: 24,
    successRate: 95,
    createdAt: '2024-01-15',
    updatedAt: '2024-03-10',
  },
  {
    id: '2',
    name: 'Sauerkraut Brine Culture',
    category: 'brine',
    status: 'fermenting',
    description: 'Traditional sauerkraut fermentation culture from Eastern Europe',
    origin: 'Krakow, Poland',
    source: 'Family recipe',
    acquisitionDate: '2024-02-01',
    expirationDate: '2024-08-01',
    storageConditions: 'Airtight container, refrigerated',
    optimalTemp: 68,
    optimalPh: 3.5,
    currentPh: 4.2,
    currentTemp: 70,
    ingredients: ['Cabbage', 'Salt', 'Water', 'Lactic acid bacteria'],
    allergens: [],
    usage: ['Sauerkraut', 'Kimchi variations', 'Pickled vegetables'],
    yield: '5 lbs cabbage makes 4 quarts sauerkraut',
    preparationTime: 2,
    fermentationTime: 168, // 7 days
    notes: 'Keep submerged in brine. Weight down cabbage to prevent exposure to air.',
    isActive: true,
    batchCount: 8,
    successRate: 88,
    createdAt: '2024-02-01',
    updatedAt: '2024-03-12',
  },
  {
    id: '3',
    name: 'Memphis BBQ Rub Culture',
    category: 'rub',
    status: 'active',
    description: 'Dry rub blend with fermented spices for enhanced flavor',
    origin: 'Memphis, TN',
    source: 'Central BBQ',
    acquisitionDate: '2024-01-20',
    expirationDate: '2024-12-20',
    storageConditions: 'Airtight container, cool dark place',
    optimalTemp: 70,
    optimalPh: 6.5,
    ingredients: ['Paprika', 'Brown sugar', 'Garlic powder', 'Onion powder', 'Cayenne', 'Cumin', 'Fermented chili'],
    allergens: [],
    usage: ['Pork shoulder', 'Ribs', 'Brisket', 'Chicken'],
    yield: '2 cups rub covers 10 lbs meat',
    preparationTime: 0.5,
    fermentationTime: 48,
    notes: 'Fermented chili adds depth. Store in airtight container to maintain potency.',
    isActive: true,
    batchCount: 15,
    successRate: 92,
    createdAt: '2024-01-20',
    updatedAt: '2024-03-08',
  },
];

const MOCK_BATCHES: FermentationBatch[] = [
  {
    id: '1',
    cultureId: '2',
    batchName: 'Spring Sauerkraut Batch',
    status: 'active',
    startDate: '2024-03-10',
    expectedEndDate: '2024-03-17',
    initialPh: 6.2,
    currentPh: 4.2,
    targetPh: 3.5,
    temperature: 68,
    vessel: '5 Gallon Fermentation Crock',
    volume: 15,
    ingredients: [
      { name: 'Green cabbage', amount: 10, unit: 'lbs', type: 'base' },
      { name: 'Sea salt', amount: 0.3, unit: 'lbs', type: 'additive' },
      { name: 'Caraway seeds', amount: 0.1, unit: 'lbs', type: 'flavor' },
    ],
    measurements: [
      { timestamp: '2024-03-10T10:00:00', type: 'ph', value: 6.2, unit: 'pH' },
      { timestamp: '2024-03-11T10:00:00', type: 'ph', value: 5.8, unit: 'pH' },
      { timestamp: '2024-03-12T10:00:00', type: 'ph', value: 4.8, unit: 'pH' },
      { timestamp: '2024-03-13T10:00:00', type: 'ph', value: 4.2, unit: 'pH' },
    ],
    notes: 'Fermentation progressing well. Good lactic acid development.',
    success: true,
    yield: '4.5 quarts',
    quality: 'excellent',
    issues: [],
    createdAt: '2024-03-10',
  },
];

const MOCK_RECIPES: Recipe[] = [
  {
    id: '1',
    name: 'Classic Sourdough Bread',
    category: 'starter',
    description: 'Traditional sourdough bread with crispy crust and open crumb',
    cultureId: '1',
    prepTime: 30,
    fermentTime: 12,
    difficulty: 'medium',
    servings: 2,
    ingredients: [
      { name: 'Active sourdough starter', amount: 1, unit: 'cup', optional: false },
      { name: 'Bread flour', amount: 4, unit: 'cups', optional: false },
      { name: 'Water', amount: 1.5, unit: 'cups', optional: false },
      { name: 'Salt', amount: 2, unit: 'tsp', optional: false },
    ],
    instructions: [
      'Mix starter, water, and flour to create autolyse',
      'Let rest for 30 minutes',
      'Add salt and perform stretch and folds',
      'Bulk ferment for 4-6 hours',
      'Shape and proof overnight in refrigerator',
      'Bake at 450°F for 30 minutes',
    ],
    tips: [
      'Use a Dutch oven for better crust',
      'Test readiness with finger poke test',
      'Score dough before baking for oven spring',
    ],
    variations: ['Add herbs', 'Use whole wheat', 'Add cheese'],
    storage: 'Room temperature for 2 days, then refrigerate',
    shelfLife: '5 days',
    rating: 4.8,
    reviews: 156,
    author: 'Master Baker',
    createdAt: '2024-01-15',
    updatedAt: '2024-02-20',
  },
];

const MOCK_LOGS: CultureLog[] = [
  {
    id: '1',
    cultureId: '1',
    action: 'fed',
    timestamp: '2024-03-12T08:00:00',
    details: 'Fed with equal parts flour and water',
    performedBy: 'John Doe',
    notes: 'Starter was very active after feeding',
    attachments: [],
  },
  {
    id: '2',
    cultureId: '2',
    batchId: '1',
    action: 'tested',
    timestamp: '2024-03-13T10:00:00',
    details: 'pH measurement taken',
    performedBy: 'Jane Smith',
    notes: 'pH at 4.2, progressing well',
    attachments: ['ph_reading_0313.jpg'],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function CulturesModule() {
  const [activeTab, setActiveTab] = useState<'cultures' | 'batches' | 'recipes' | 'logs'>('cultures');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CultureCategory | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<CultureStatus | 'all'>('all');

  const [cultures] = useState<Culture[]>(MOCK_CULTURES);
  const [batches] = useState<FermentationBatch[]>(MOCK_BATCHES);
  const [recipes] = useState<Recipe[]>(MOCK_RECIPES);
  const [logs] = useState<CultureLog[]>(MOCK_LOGS);

  const filteredCultures = useMemo(() => {
    return cultures.filter(culture => {
      const matchesSearch = culture.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        culture.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        culture.origin.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || culture.category === selectedCategory;
      const matchesStatus = selectedStatus === 'all' || culture.status === selectedStatus;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [cultures, searchTerm, selectedCategory, selectedStatus]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-50';
      case 'dormant': return 'text-blue-600 bg-blue-50';
      case 'contaminated': return 'text-red-600 bg-red-50';
      case 'expired': return 'text-gray-600 bg-gray-50';
      case 'preparing': return 'text-yellow-600 bg-yellow-50';
      case 'fermenting': return 'text-orange-600 bg-orange-50';
      case 'initial': return 'text-purple-600 bg-purple-50';
      case 'peak': return 'text-orange-600 bg-orange-50';
      case 'declining': return 'text-yellow-600 bg-yellow-50';
      case 'complete': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Activity className="w-4 h-4" />;
      case 'dormant': return <Clock className="w-4 h-4" />;
      case 'contaminated': return <AlertTriangle className="w-4 h-4" />;
      case 'expired': return <X className="w-4 h-4" />;
      case 'preparing': return <BeakerIcon className="w-4 h-4" />;
      case 'fermenting': return <Zap className="w-4 h-4" />;
      case 'initial': return <Play className="w-4 h-4" />;
      case 'peak': return <TrendingUp className="w-4 h-4" />;
      case 'declining': return <TrendingDown className="w-4 h-4" />;
      case 'complete': return <CheckCircle className="w-4 h-4" />;
      default: return <Circle className="w-4 h-4" />;
    }
  };

  const getCategoryIcon = (category: CultureCategory) => {
    switch (category) {
      case 'starter': return <Microscope className="w-4 h-4" />;
      case 'brine': return <Droplets className="w-4 h-4" />;
      case 'rub': return <Sparkles className="w-4 h-4" />;
      case 'sauce': return <Beaker className="w-4 h-4" />;
      case 'pickle': return <Package className="w-4 h-4" />;
      case 'cure': return <Timer className="w-4 h-4" />;
      case 'marinade': return <BeakerIcon className="w-4 h-4" />;
      case 'injection': return <Zap className="w-4 h-4" />;
      default: return <Beaker className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="flex items-center gap-3">
          <Microscope className="w-6 h-6 text-purple-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Colters Cultures & Fermentation</h1>
            <p className="text-sm text-gray-500">Food culture management and tracking system</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Culture
          </button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white">
        {[
          { id: 'cultures', label: 'Cultures', icon: Microscope, count: cultures.filter(c => c.isActive).length },
          { id: 'batches', label: 'Batches', icon: Beaker, count: batches.filter(b => b.status === 'active').length },
          { id: 'recipes', label: 'Recipes', icon: ChefHat, count: recipes.length },
          { id: 'logs', label: 'Activity Log', icon: FileText, count: logs.length },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${activeTab === tab.id
              ? 'border-purple-600 text-purple-600 bg-purple-50'
              : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tab.label}</span>
            {tab.count > 0 && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 border-b bg-white">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search cultures..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value as any)}
          className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Categories</option>
          <option value="starter">Starters</option>
          <option value="brine">Brines</option>
          <option value="rub">Rubs</option>
          <option value="sauce">Sauces</option>
          <option value="pickle">Pickles</option>
          <option value="cure">Cures</option>
          <option value="marinade">Marinades</option>
          <option value="injection">Injections</option>
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as any)}
          className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
          <option value="fermenting">Fermenting</option>
          <option value="preparing">Preparing</option>
          <option value="contaminated">Contaminated</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'cultures' && (
          <div className="grid gap-4">
            {filteredCultures.map(culture => (
              <div key={culture.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">{culture.name}</h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full flex items-center gap-1 ${getStatusColor(culture.status)}`}>
                        {getStatusIcon(culture.status)}
                        {culture.status.replace('_', ' ')}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700 flex items-center gap-1">
                        {getCategoryIcon(culture.category)}
                        {culture.category}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{culture.description}</p>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                      <div>
                        <span className="text-gray-500">Origin:</span>
                        <p className="font-semibold text-gray-900">{culture.origin}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Source:</span>
                        <p className="font-semibold text-gray-900">{culture.source}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Success Rate:</span>
                        <p className="font-semibold text-gray-900">{culture.successRate}%</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Batches:</span>
                        <p className="font-semibold text-gray-900">{culture.batchCount}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                      <div>
                        <span className="text-gray-500">Optimal Temp:</span>
                        <p className="font-semibold text-gray-900">{culture.optimalTemp}°F</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Optimal pH:</span>
                        <p className="font-semibold text-gray-900">{culture.optimalPh}</p>
                      </div>
                      {culture.currentPh && (
                        <div>
                          <span className="text-gray-500">Current pH:</span>
                          <p className="font-semibold text-gray-900">{culture.currentPh}</p>
                        </div>
                      )}
                      {culture.currentTemp && (
                        <div>
                          <span className="text-gray-500">Current Temp:</span>
                          <p className="font-semibold text-gray-900">{culture.currentTemp}°F</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-4 mb-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {culture.preparationTime}h prep
                      </span>
                      <span className="flex items-center gap-1">
                        <Timer className="w-4 h-4" />
                        {culture.fermentationTime}h ferment
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="w-4 h-4" />
                        {culture.yield}
                      </span>
                    </div>

                    {culture.allergens.length > 0 && (
                      <div className="mb-3">
                        <span className="text-sm font-medium text-red-600">Allergens: </span>
                        <span className="text-sm text-gray-600">{culture.allergens.join(', ')}</span>
                      </div>
                    )}

                    {culture.notes && (
                      <p className="text-sm text-gray-600 mb-3">{culture.notes}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {culture.usage.slice(0, 3).map((use, idx) => (
                        <span key={idx} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                          {use}
                        </span>
                      ))}
                      {culture.usage.length > 3 && (
                        <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                          +{culture.usage.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                      <GitBranch className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'batches' && (
          <div className="grid gap-4">
            {batches.map(batch => {
              const culture = cultures.find(c => c.id === batch.cultureId);
              return (
                <div key={batch.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{batch.batchName}</h3>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full flex items-center gap-1 ${getStatusColor(batch.status)}`}>
                          {getStatusIcon(batch.status)}
                          {batch.status.replace('_', ' ')}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                          {culture?.name}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-gray-500">Start Date:</span>
                          <p className="font-semibold text-gray-900">{new Date(batch.startDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Expected End:</span>
                          <p className="font-semibold text-gray-900">{new Date(batch.expectedEndDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Volume:</span>
                          <p className="font-semibold text-gray-900">{batch.volume}L</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Vessel:</span>
                          <p className="font-semibold text-gray-900">{batch.vessel}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-gray-500">Initial pH:</span>
                          <p className="font-semibold text-gray-900">{batch.initialPh}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Current pH:</span>
                          <p className="font-semibold text-gray-900">{batch.currentPh}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Target pH:</span>
                          <p className="font-semibold text-gray-900">{batch.targetPh}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Temperature:</span>
                          <p className="font-semibold text-gray-900">{batch.temperature}°F</p>
                        </div>
                      </div>

                      <div className="mb-3">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Ingredients:</h4>
                        <div className="flex flex-wrap gap-2">
                          {batch.ingredients.map((ingredient, idx) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                              {ingredient.amount} {ingredient.unit} {ingredient.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      {batch.measurements.length > 0 && (
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Recent Measurements:</h4>
                          <div className="space-y-1">
                            {batch.measurements.slice(-3).map((measurement, idx) => (
                              <div key={idx} className="text-sm text-gray-600">
                                {new Date(measurement.timestamp).toLocaleString()} - {measurement.type}: {measurement.value} {measurement.unit}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {batch.notes && (
                        <p className="text-sm text-gray-600 mb-3">{batch.notes}</p>
                      )}

                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <Target className="w-4 h-4" />
                          Yield: {batch.yield}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          Quality: {batch.quality}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="grid gap-4">
            {recipes.map(recipe => {
              const culture = cultures.find(c => c.id === recipe.cultureId);
              return (
                <div key={recipe.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{recipe.name}</h3>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                          {recipe.category}
                        </span>
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-yellow-500 fill-current" />
                          <span className="text-sm font-medium">{recipe.rating}</span>
                          <span className="text-sm text-gray-500">({recipe.reviews})</span>
                        </div>
                      </div>

                      <p className="text-sm text-gray-600 mb-3">{recipe.description}</p>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-gray-500">Prep Time:</span>
                          <p className="font-semibold text-gray-900">{recipe.prepTime} min</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Ferment Time:</span>
                          <p className="font-semibold text-gray-900">{recipe.fermentTime}h</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Servings:</span>
                          <p className="font-semibold text-gray-900">{recipe.servings}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Difficulty:</span>
                          <p className="font-semibold text-gray-900 capitalize">{recipe.difficulty}</p>
                        </div>
                      </div>

                      {culture && (
                        <div className="mb-3">
                          <span className="text-sm font-medium text-purple-600">Uses: {culture.name}</span>
                        </div>
                      )}

                      <div className="mb-3">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Key Ingredients:</h4>
                        <div className="flex flex-wrap gap-2">
                          {recipe.ingredients.slice(0, 4).map((ingredient, idx) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                              {ingredient.amount} {ingredient.unit} {ingredient.name}
                            </span>
                          ))}
                          {recipe.ingredients.length > 4 && (
                            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                              +{recipe.ingredients.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          Shelf life: {recipe.shelfLife}
                        </span>
                        <span className="flex items-center gap-1">
                          <Package className="w-4 h-4" />
                          {recipe.storage}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                        <Heart className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4">
            {logs.map(log => {
              const culture = cultures.find(c => c.id === log.cultureId);
              return (
                <div key={log.id} className="bg-white rounded-lg border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700 capitalize">
                          {log.action}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{culture?.name}</span>
                        <span className="text-sm text-gray-500">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{log.details}</p>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>By: {log.performedBy}</span>
                        {log.notes && <span>Notes: {log.notes}</span>}
                      </div>
                      {log.attachments.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          {log.attachments.map((attachment, idx) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                              📎 {attachment}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
