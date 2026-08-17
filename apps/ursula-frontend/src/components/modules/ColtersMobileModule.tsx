/**
 * ColtersMobileModule — Mobile Operations Portal (PWA)
 *
 * Mobile-first responsive interface for Colters smokehouse operations.
 */

import React, { useState, useEffect } from 'react';
import {
    Flame, AlertTriangle, ShoppingCart, Thermometer, BeakerIcon,
    Package, ClipboardList, Wifi, WifiOff, Bell, Plus, Phone,
    Home, Settings, Clock, CheckCircle, Activity, ArrowRight, X,
} from 'lucide-react';

type MobileScreen = 'home' | 'orders' | 'smoke' | 'cultures' | 'inventory' | 'compliance';
type ConnectionStatus = 'online' | 'offline' | 'syncing';

interface MobileAlert {
    id: string;
    type: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    message: string;
    actionRequired: boolean;
    timestamp: string;
    dismissed: boolean;
    screen?: MobileScreen;
}

interface MobileOrder {
    id: string;
    customerName: string;
    items: number;
    total: number;
    status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed';
    dueTime: string;
    priority: 'high' | 'medium' | 'low';
    customerPhone?: string;
}

const MOCK_ALERTS: MobileAlert[] = [
    {
        id: '1',
        type: 'critical',
        title: 'Brisket Batch Overdue',
        message: 'Batch #B-2024-037 should have completed 2 hours ago',
        actionRequired: true,
        timestamp: '2024-03-12T14:30:00Z',
        dismissed: false,
        screen: 'smoke',
    },
    {
        id: '2',
        type: 'high',
        title: 'Sourdough pH Low',
        message: 'Current pH: 3.6 (Target: 4.0-4.2)',
        actionRequired: true,
        timestamp: '2024-03-12T13:15:00Z',
        dismissed: false,
        screen: 'cultures',
    },
];

const MOCK_ORDERS: MobileOrder[] = [
    {
        id: '1',
        customerName: 'Joe\'s BBQ Shack',
        items: 3,
        total: 287.50,
        status: 'ready',
        dueTime: '2:30 PM',
        priority: 'high',
        customerPhone: '555-0123',
    },
    {
        id: '2',
        customerName: 'Suzie\'s Restaurant',
        items: 2,
        total: 156.75,
        status: 'ready',
        dueTime: '3:00 PM',
        priority: 'medium',
        customerPhone: '555-0456',
    },
];

const MobileHomeScreen = ({
    alerts,
    onNavigate,
    onDismissAlert,
    connectionStatus
}: {
    alerts: MobileAlert[];
    onNavigate: (screen: MobileScreen) => void;
    onDismissAlert: (alertId: string) => void;
    connectionStatus: ConnectionStatus;
}) => {
    const urgentAlerts = alerts.filter(a => !a.dismissed && ['critical', 'high'].includes(a.type));

    return (
        <div className="space-y-4 p-4">
            {/* Connection Status */}
            <div className={`flex items-center justify-between p-3 rounded-lg ${connectionStatus === 'online' ? 'bg-green-50' : 'bg-red-50'
                }`}>
                <div className="flex items-center gap-2">
                    {connectionStatus === 'online' ? <Wifi className="w-4 h-4 text-green-600" /> : <WifiOff className="w-4 h-4 text-red-600" />}
                    <span className={`text-sm font-medium ${connectionStatus === 'online' ? 'text-green-800' : 'text-red-800'
                        }`}>
                        {connectionStatus === 'online' ? 'Online' : 'Offline'}
                    </span>
                </div>
            </div>

            {/* Urgent Alerts */}
            {urgentAlerts.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-gray-900">Urgent Alerts</h3>
                    {urgentAlerts.map(alert => (
                        <div key={alert.id} className={`p-3 rounded-lg border ${alert.type === 'critical' ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
                            }`}>
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h4 className="font-semibold">{alert.title}</h4>
                                    <p className="text-sm opacity-90">{alert.message}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {alert.screen && (
                                        <button onClick={() => onNavigate(alert.screen!)} className="p-1 bg-white/20 rounded">
                                            <ArrowRight className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={() => onDismissAlert(alert.id)} className="p-1 bg-white/20 rounded">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Quick Actions */}
            <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Quick Actions</h3>
                <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => onNavigate('smoke')} className="p-4 bg-orange-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <Thermometer className="w-6 h-6" />
                        <span className="text-xs font-medium">Log Temp</span>
                    </button>
                    <button onClick={() => onNavigate('cultures')} className="p-4 bg-purple-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <BeakerIcon className="w-6 h-6" />
                        <span className="text-xs font-medium">Check pH</span>
                    </button>
                    <button onClick={() => onNavigate('orders')} className="p-4 bg-blue-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <ShoppingCart className="w-6 h-6" />
                        <span className="text-xs font-medium">Orders</span>
                    </button>
                    <button onClick={() => onNavigate('inventory')} className="p-4 bg-green-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <Package className="w-6 h-6" />
                        <span className="text-xs font-medium">Inventory</span>
                    </button>
                    <button onClick={() => onNavigate('compliance')} className="p-4 bg-red-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <ClipboardList className="w-6 h-6" />
                        <span className="text-xs font-medium">Compliance</span>
                    </button>
                    <button className="p-4 bg-indigo-500 text-white rounded-xl flex flex-col items-center gap-2">
                        <Plus className="w-6 h-6" />
                        <span className="text-xs font-medium">Scan QR</span>
                    </button>
                </div>
            </div>

            {/* Today's Summary */}
            <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Today&apos;s Summary</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 p-3 rounded-lg">
                        <div className="flex items-center gap-2 text-blue-600 mb-1">
                            <ShoppingCart className="w-4 h-4" />
                            <span className="text-sm font-medium">Orders</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-900">8</div>
                        <div className="text-xs text-blue-600">3 ready</div>
                    </div>
                    <div className="bg-orange-50 p-3 rounded-lg">
                        <div className="flex items-center gap-2 text-orange-600 mb-1">
                            <Flame className="w-4 h-4" />
                            <span className="text-sm font-medium">Smoking</span>
                        </div>
                        <div className="text-2xl font-bold text-orange-900">2</div>
                        <div className="text-xs text-orange-600">1 delayed</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MobileOrdersScreen = ({ orders }: { orders: MobileOrder[] }) => {
    return (
        <div className="space-y-4 p-4">
            <h3 className="text-lg font-semibold text-gray-900">Orders</h3>
            <div className="space-y-3">
                {orders.map(order => (
                    <div key={order.id} className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                            <div>
                                <h4 className="font-semibold text-gray-900">{order.customerName}</h4>
                                <p className="text-sm text-gray-500">{order.items} items • ${order.total}</p>
                                <p className="text-sm text-gray-500">Due: {order.dueTime}</p>
                            </div>
                            <span className={`px-2 py-1 text-xs rounded-full ${order.status === 'ready' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                {order.status}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <button className="flex-1 bg-green-500 text-white py-2 px-3 rounded-lg text-sm font-medium">
                                Complete Pickup
                            </button>
                            {order.customerPhone && (
                                <button className="bg-gray-100 text-gray-700 py-2 px-3 rounded-lg text-sm font-medium">
                                    <Phone className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function ColtersMobileModule() {
    const [currentScreen, setCurrentScreen] = useState<MobileScreen>('home');
    const [alerts, setAlerts] = useState(MOCK_ALERTS);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('online');

    useEffect(() => {
        const interval = setInterval(() => {
            setConnectionStatus(Math.random() > 0.9 ? 'offline' : 'online');
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleDismissAlert = (alertId: string) => {
        setAlerts(prev => prev.map(alert =>
            alert.id === alertId ? { ...alert, dismissed: true } : alert
        ));
    };

    const renderScreen = () => {
        switch (currentScreen) {
            case 'home':
                return (
                    <MobileHomeScreen
                        alerts={alerts}
                        onNavigate={setCurrentScreen}
                        onDismissAlert={handleDismissAlert}
                        connectionStatus={connectionStatus}
                    />
                );
            case 'orders':
                return <MobileOrdersScreen orders={MOCK_ORDERS} />;
            default:
                return (
                    <div className="p-4 text-center text-gray-500">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">
                            {currentScreen.charAt(0).toUpperCase() + currentScreen.slice(1)}
                        </h3>
                        <p>Coming soon...</p>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Flame className="w-6 h-6 text-orange-600" />
                        <div>
                            <h1 className="text-lg font-bold text-gray-900">Colters Ops</h1>
                            <p className="text-xs text-gray-500">Mobile Portal</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg relative">
                            <Bell className="w-5 h-5" />
                            {alerts.filter(a => !a.dismissed).length > 0 && (
                                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                            )}
                        </button>
                        <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                {renderScreen()}
            </div>

            {/* Bottom Navigation */}
            <div className="bg-white border-t border-gray-200">
                <div className="flex justify-around py-2">
                    {[
                        { id: 'home', icon: Home, label: 'Home' },
                        { id: 'orders', icon: ShoppingCart, label: 'Orders' },
                        { id: 'smoke', icon: Flame, label: 'Smoke' },
                        { id: 'cultures', icon: BeakerIcon, label: 'Cultures' },
                        { id: 'inventory', icon: Package, label: 'Inventory' },
                        { id: 'compliance', icon: ClipboardList, label: 'Compliance' },
                    ].map(({ id, icon: Icon, label }) => (
                        <button
                            key={id}
                            onClick={() => setCurrentScreen(id as MobileScreen)}
                            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors ${currentScreen === id ? 'text-orange-600' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Icon className="w-5 h-5" />
                            <span className="text-xs">{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}