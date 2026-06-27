/**
 * ColtersCommandModule — Daily Operations Dashboard & Command Center
 *
 * The central command hub for Colters Smokehouse operations.
 * Provides real-time dashboard, alerts, KPIs, and quick actions.
 * This is the home screen that gives Colters one control surface.
 *
 * Features:
 * - Today's smoking schedule and batch status
 * Orders due today and pending fulfillment
 * Low stock alerts and inventory warnings
 * Compliance items due soon
 - Culture/fermentation alerts
 * Quick-action buttons for common tasks
 * KPI dashboard with key metrics
 * Alert prioritization and dismissal
 */

import React, { useState, useMemo } from 'react';
import {
  Flame,
  AlertTriangle,
  CheckCircle,
  Clock,
  Package,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Thermometer,
  BeakerIcon,
  Calendar,
  RefreshCw,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  Zap,
  Target,
  Award,
  Heart,
  Brain,
  Sparkles,
  GitBranch,
  Layers,
  Star,
  MapPin,
  Scale,
  ClipboardList,
  Circle,
  Play,
  TrendingDown as TrendingDownIcon,
  X,
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
  Activity,
  AlertCircle,
  CheckSquare,
  Square,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  MoreVertical,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type AlertPriority = 'critical' | 'high' | 'medium' | 'low';
type AlertType = 'inventory' | 'schedule' | 'order' | 'compliance' | 'culture' | 'quality' | 'system';

interface Alert {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  actionRequired: boolean;
  dueDate?: string;
  dismissible: boolean;
  dismissed: boolean;
  createdAt: string;
  actionUrl?: string;
}

interface KPI {
  label: string;
  value: string | number;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
  icon: React.ElementType;
  color: string;
}

interface TodaySchedule {
  id: string;
  productName: string;
  productType: 'smoking' | 'fermentation' | 'prep';
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'delayed';
  priority: 'high' | 'medium' | 'low';
  notes: string;
}

interface OrderAlert {
  id: string;
  customerName: string;
  orderTotal: number;
  dueDate: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'overdue';
  items: number;
  notes: string;
}

interface InventoryAlert {
  id: string;
  productName: string;
  currentStock: number;
  minOrder: number;
  maxOrder: number;
  status: 'out_of_stock' | 'low_stock' | 'critical';
  suggestedOrder: number;
  urgency: 'immediate' | 'today' | 'this_week';
}

interface ComplianceAlert {
  id: string;
  type: 'inspection' | 'temperature_log' | 'cleaning' | 'safety';
  title: string;
  dueDate: string;
  status: 'due_soon' | 'overdue' | 'completed';
  assignedTo?: string;
}

interface CultureAlert {
  id: string;
  cultureName: string;
  batchId: string;
  alertType: 'ph_out_of_range' | 'temperature_issue' | 'feeding_due' | 'contamination_risk' | 'harvest_ready';
  currentPh?: number;
  targetPh?: number;
  currentTemp?: number;
  targetTemp?: number;
  urgency: 'immediate' | 'today' | 'this_week';
  actionRequired: string;
}

/* ------------------------------------------------------------------ */
/*  Mock Data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_ALERTS: Alert[] = [
  {
    id: '1',
    type: 'inventory',
    priority: 'critical',
    title: 'Critical: Colters Signature Brisket Out of Stock',
    message: 'No inventory available. 3 orders pending fulfillment.',
    actionRequired: true,
    dueDate: '2024-03-13T08:00:00Z',
    dismissible: false,
    dismissed: false,
    createdAt: '2024-03-12T14:30:00Z',
    actionUrl: '/smokehouse/products/1',
  },
  {
    id: '2',
    type: 'schedule',
    priority: 'high',
    title: 'Smoking Schedule Delayed',
    message: 'Brisket batch #B-2024-037 running 2 hours behind schedule.',
    actionRequired: true,
    dueDate: '2024-03-12T16:00:00Z',
    dismissible: false,
    dismissed: false,
    createdAt: '2024-03-12T12:15:00Z',
    actionUrl: '/smokehouse/schedules/45',
  },
  {
    id: '3',
    type: 'order',
    priority: 'medium',
    title: 'Large Order Due Today',
    message: 'Joe\'s BBQ Shack - 25lb order due by 6 PM',
    actionRequired: true,
    dueDate: '2024-03-12T18:00:00Z',
    dismissible: true,
    dismissed: false,
    createdAt: '2024-03-12T09:00:00Z',
    actionUrl: '/smokehouse/orders/789',
  },
  {
    id: '4',
    type: 'culture',
    priority: 'high',
    title: 'Sourdough Starter pH Out of Range',
    message: 'Current pH: 3.8 (Target: 4.0-4.2). Action required within 2 hours.',
    actionRequired: true,
    dueDate: '2024-03-12T15:00:00Z',
    dismissible: false,
    dismissed: false,
    createdAt: '2024-03-12T13:00:00Z',
    actionUrl: '/cultures/batches/234',
  },
  {
    id: '5',
    type: 'compliance',
    priority: 'medium',
    title: 'Health Inspection Due Tomorrow',
    message: 'Quarterly health inspection scheduled for March 13 at 10 AM.',
    actionRequired: true,
    dueDate: '2024-03-13T10:00:00Z',
    dismissible: true,
    dismissed: false,
    createdAt: '2024-03-12T08:00:00Z',
  },
];

const MOCK_KPIS: KPI[] = [
  {
    label: 'Today\'s Revenue',
    value: '$2,847',
    change: 12.5,
    changeType: 'increase',
    icon: DollarSign,
    color: 'text-green-600',
  },
  {
    label: 'Orders Pending',
    value: 8,
    change: -2,
    changeType: 'decrease',
    icon: ShoppingCart,
    color: 'text-blue-600',
  },
  {
    label: 'Active Smoking',
    value: 3,
    change: 0,
    changeType: 'neutral',
    icon: Flame,
    color: 'text-orange-600',
  },
  {
    label: 'Low Stock Items',
    value: 4,
    change: 1,
    changeType: 'increase',
    icon: Package,
    color: 'text-red-600',
  },
  {
    label: 'Cultures Needing Attention',
    value: 2,
    change: -1,
    changeType: 'decrease',
    icon: BeakerIcon,
    color: 'text-purple-600',
  },
  {
    label: 'On-Time Delivery',
    value: '94%',
    change: 2.1,
    changeType: 'increase',
    icon: Target,
    color: 'text-green-600',
  },
];

const MOCK_TODAY_SCHEDULE: TodaySchedule[] = [
  {
    id: '1',
    productName: 'Colters Signature Brisket',
    productType: 'smoking',
    startTime: '06:00',
    endTime: '20:00',
    status: 'in_progress',
    priority: 'high',
    notes: 'Large batch for weekend orders',
  },
  {
    id: '2',
    productName: 'Colters Pulled Pork',
    productType: 'smoking',
    startTime: '08:00',
    endTime: '20:00',
    status: 'in_progress',
    priority: 'medium',
    notes: 'Standard weekly batch',
  },
  {
    id: '3',
    productName: 'Sourdough Starter Feeding',
    productType: 'fermentation',
    startTime: '14:00',
    endTime: '14:30',
    status: 'scheduled',
    priority: 'high',
    notes: 'pH adjustment needed',
  },
  {
    id: '4',
    productName: 'Pickle Brine Preparation',
    productType: 'prep',
    startTime: '16:00',
    endTime: '17:00',
    status: 'scheduled',
    priority: 'medium',
    notes: 'For cucumber delivery tomorrow',
  },
];

const MOCK_ORDER_ALERTS: OrderAlert[] = [
  {
    id: '1',
    customerName: 'Joe\'s BBQ Shack',
    orderTotal: 287.50,
    dueDate: '2024-03-12T18:00:00Z',
    status: 'preparing',
    items: 3,
    notes: 'Large brisket order',
  },
  {
    id: '2',
    customerName: 'Suzie\'s Restaurant',
    orderTotal: 156.75,
    dueDate: '2024-03-12T17:00:00Z',
    status: 'ready',
    items: 2,
    notes: 'Weekly delivery',
  },
  {
    id: '3',
    customerName: 'Mike\'s Meats',
    orderTotal: 445.00,
    dueDate: '2024-03-12T19:00:00Z',
    status: 'pending',
    items: 5,
    notes: 'Wholesale order - rush',
  },
];

const MOCK_INVENTORY_ALERTS: InventoryAlert[] = [
  {
    id: '1',
    productName: 'Colters Signature Brisket',
    currentStock: 0,
    minOrder: 2,
    maxOrder: 20,
    status: 'out_of_stock',
    suggestedOrder: 25,
    urgency: 'immediate',
  },
  {
    id: '2',
    productName: 'Colters St. Louis Ribs',
    currentStock: 8,
    minOrder: 1,
    maxOrder: 10,
    status: 'low_stock',
    suggestedOrder: 15,
    urgency: 'today',
  },
  {
    id: '3',
    productName: 'Colters Smoked Sausage',
    currentStock: 3,
    minOrder: 2,
    maxOrder: 12,
    status: 'critical',
    suggestedOrder: 20,
    urgency: 'immediate',
  },
];

const MOCK_COMPLIANCE_ALERTS: ComplianceAlert[] = [
  {
    id: '1',
    type: 'inspection',
    title: 'Quarterly Health Inspection',
    dueDate: '2024-03-13T10:00:00Z',
    status: 'due_soon',
    assignedTo: 'Sarah Chen',
  },
  {
    id: '2',
    type: 'temperature_log',
    title: 'Daily Temperature Logs',
    dueDate: '2024-03-12T20:00:00Z',
    status: 'due_soon',
    assignedTo: 'Mike Rodriguez',
  },
];

const MOCK_CULTURE_ALERTS: CultureAlert[] = [
  {
    id: '1',
    cultureName: 'Sourdough Starter',
    batchId: 'SD-2024-03-12',
    alertType: 'ph_out_of_range',
    currentPh: 3.8,
    targetPh: 4.1,
    urgency: 'immediate',
    actionRequired: 'Adjust pH with flour feeding',
  },
  {
    id: '2',
    cultureName: 'Kimchi Batch',
    batchId: 'KIM-2024-03-10',
    alertType: 'harvest_ready',
    urgency: 'today',
    actionRequired: 'Transfer to cold storage',
  },
];

/* ------------------------------------------------------------------ */
/*  Helper Functions                                                  */
/* ------------------------------------------------------------------ */

const getPriorityColor = (priority: AlertPriority) => {
  switch (priority) {
    case 'critical': return 'text-red-600 bg-red-50 border-red-200';
    case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'in_progress': return <Activity className="w-4 h-4 text-blue-600" />;
    case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
    case 'scheduled': return <Clock className="w-4 h-4 text-gray-600" />;
    case 'delayed': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
    case 'ready': return <CheckSquare className="w-4 h-4 text-green-600" />;
    case 'pending': return <Circle className="w-4 h-4 text-gray-600" />;
    case 'overdue': return <AlertCircle className="w-4 h-4 text-red-600" />;
    default: return <Circle className="w-4 h-4 text-gray-600" />;
  }
};

const formatTime = (timeString: string) => {
  return new Date(timeString).toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export default function ColtersCommandModule() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS);
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedAlertType, setSelectedAlertType] = useState<AlertType | 'all'>('all');

  const filteredAlerts = useMemo(() => {
    return alerts.filter(alert => {
      if (selectedAlertType !== 'all' && alert.type !== selectedAlertType) return false;
      if (!showDismissed && alert.dismissed) return false;
      return true;
    });
  }, [alerts, showDismissed, selectedAlertType]);

  const activeAlerts = useMemo(() => {
    return alerts.filter(alert => !alert.dismissed);
  }, [alerts]);

  const criticalAlerts = useMemo(() => {
    return activeAlerts.filter(alert => alert.priority === 'critical');
  }, [activeAlerts]);

  const dismissAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, dismissed: true } : alert
    ));
  };

  const undismissAllAlerts = () => {
    setAlerts(prev => prev.map(alert => ({ ...alert, dismissed: false })));
  };

  return (
    <div className="flex-1 bg-gray-50 overflow-auto">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Flame className="w-8 h-8 text-orange-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Colters Command</h1>
                <p className="text-sm text-gray-500">Daily Operations Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <div className="text-sm text-gray-500">
                Last updated: {formatTime(new Date().toISOString())}
              </div>
            </div>
          </div>
        </div>

        {/* Critical Alerts Banner */}
        {criticalAlerts.length > 0 && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">
                  {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''} Require Immediate Action
                </h3>
                <div className="mt-2 space-y-1">
                  {criticalAlerts.map(alert => (
                    <div key={alert.id} className="text-sm text-red-800">
                      • {alert.title}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI Dashboard */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Performance</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {MOCK_KPIS.map((kpi, index) => {
              const Icon = kpi.icon;
              return (
                <div key={index} className="bg-white p-4 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <Icon className={`w-5 h-5 ${kpi.color}`} />
                    {kpi.change && (
                      <div className={`flex items-center text-xs ${
                        kpi.changeType === 'increase' ? 'text-green-600' : 
                        kpi.changeType === 'decrease' ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {kpi.changeType === 'increase' && <ArrowUp className="w-3 h-3" />}
                        {kpi.changeType === 'decrease' && <ArrowDown className="w-3 h-3" />}
                        {Math.abs(kpi.change)}%
                      </div>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
                  <div className="text-xs text-gray-500">{kpi.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Today's Schedule */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Today's Schedule</h2>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {MOCK_TODAY_SCHEDULE.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(item.status)}
                        <div>
                          <div className="font-medium text-gray-900">{item.productName}</div>
                          <div className="text-sm text-gray-500">
                            {formatTime(`2024-03-12T${item.startTime}:00Z`)} - {formatTime(`2024-03-12T${item.endTime}:00Z`)}
                          </div>
                          {item.notes && (
                            <div className="text-xs text-gray-400 mt-1">{item.notes}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          item.priority === 'high' ? 'bg-red-100 text-red-700' :
                          item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {item.priority}
                        </span>
                        <button className="p-1 text-gray-400 hover:text-gray-600">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Alerts Section */}
            <div className="mt-6 bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Alerts ({activeAlerts.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedAlertType}
                      onChange={(e) => setSelectedAlertType(e.target.value as AlertType | 'all')}
                      className="text-sm border border-gray-300 rounded px-2 py-1"
                    >
                      <option value="all">All Types</option>
                      <option value="inventory">Inventory</option>
                      <option value="schedule">Schedule</option>
                      <option value="order">Orders</option>
                      <option value="compliance">Compliance</option>
                      <option value="culture">Cultures</option>
                    </select>
                    <button
                      onClick={() => setShowDismissed(!showDismissed)}
                      className={`p-2 rounded ${showDismissed ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
                    >
                      {showDismissed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {filteredAlerts.map(alert => (
                    <div 
                      key={alert.id} 
                      className={`p-3 border rounded-lg ${
                        alert.dismissed ? 'opacity-50' : ''
                      } ${getPriorityColor(alert.priority)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="w-4 h-4" />
                            <h3 className="font-medium">{alert.title}</h3>
                            {alert.actionRequired && (
                              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                                Action Required
                              </span>
                            )}
                          </div>
                          <p className="text-sm opacity-90">{alert.message}</p>
                          {alert.dueDate && (
                            <div className="text-xs opacity-75 mt-1">
                              Due: {formatTime(alert.dueDate)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {alert.actionUrl && (
                            <button className="p-1 hover:bg-white/50 rounded">
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          )}
                          {alert.dismissible && (
                            <button
                              onClick={() => dismissAlert(alert.id)}
                              className="p-1 hover:bg-white/50 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {alerts.filter(a => a.dismissed).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <button
                      onClick={undismissAllAlerts}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Restore {alerts.filter(a => a.dismissed).length} dismissed alerts
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            
            {/* Quick Actions */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2">
                  <button className="p-3 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 text-sm font-medium">
                    <Plus className="w-4 h-4 mx-auto mb-1" />
                    New Order
                  </button>
                  <button className="p-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium">
                    <Package className="w-4 h-4 mx-auto mb-1" />
                    Add Product
                  </button>
                  <button className="p-3 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 text-sm font-medium">
                    <Calendar className="w-4 h-4 mx-auto mb-1" />
                    Schedule Batch
                  </button>
                  <button className="p-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm font-medium">
                    <BeakerIcon className="w-4 h-4 mx-auto mb-1" />
                    Culture Log
                  </button>
                </div>
              </div>
            </div>

            {/* Orders Due Today */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Orders Due Today</h2>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {MOCK_ORDER_ALERTS.map(order => (
                    <div key={order.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-gray-900">{order.customerName}</div>
                        <div className="text-sm font-medium text-gray-900">
                          {formatCurrency(order.orderTotal)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm text-gray-500">
                        <span>{order.items} items</span>
                        <span>Due: {formatTime(order.dueDate)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {getStatusIcon(order.status)}
                        <span className="text-xs capitalize">{order.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Inventory Alerts */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Inventory Alerts</h2>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {MOCK_INVENTORY_ALERTS.map(item => (
                    <div key={item.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-gray-900">{item.productName}</div>
                        <div className={`text-sm font-medium ${
                          item.status === 'out_of_stock' ? 'text-red-600' :
                          item.status === 'critical' ? 'text-orange-600' : 'text-yellow-600'
                        }`}>
                          {item.currentStock} left
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        Order {item.suggestedOrder} units ({item.urgency})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Compliance Items */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Compliance</h2>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {MOCK_COMPLIANCE_ALERTS.map(item => (
                    <div key={item.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium text-gray-900 mb-1">{item.title}</div>
                      <div className="text-sm text-gray-500">
                        Due: {formatTime(item.dueDate)}
                      </div>
                      {item.assignedTo && (
                        <div className="text-xs text-gray-400 mt-1">
                          Assigned to: {item.assignedTo}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
