/**
 * Colters Smokehouse Operations Module
 * 
 * Comprehensive smokehouse operations management for Colters
 * including products, customers, orders, smoking schedules, and compliance.
 */

import React, { useState, useEffect } from 'react';
import {
    Package,
    Users,
    ShoppingCart,
    Calendar,
    Clock,
    Thermometer,
    AlertTriangle,
    CheckCircle,
    TrendingUp,
    Target,
    Award,
    Plus,
    Edit,
    Trash2,
    Search,
    Filter,
    Download,
    Upload,
    Eye,
    EyeOff,
    Save,
    X,
    ChevronDown,
    ChevronUp,
    MoreVertical,
    Star,
    MapPin,
    Phone,
    Mail,
    Scale,
    Warehouse,
    ClipboardList,
    Flame,
    Timer,
    Activity,
    BarChart3,
    FileText,
    Settings,
    RefreshCw,
    Beef,
    Drumstick,
} from 'lucide-react';

// Import types
import type {
    Product,
    Customer,
    Order,
    SmokingSchedule,
    ComplianceRecord,
    Culture,
    FermentationBatch,
    Recipe
} from '@/types/smokehouse';

// Mock data for Colters products
const COLTERS_PRODUCTS: Product[] = [
    {
        id: 'brisket-001',
        name: 'Colters Signature Brisket',
        description: '14-day dry aged, hickory smoked brisket with Colters secret spice rub',
        category: 'beef',
        status: 'available',
        price: 18.99,
        weight: 14,
        inventory: 45,
        minOrder: 2,
        maxOrder: 20,
        woodType: 'hickory',
        spiceRub: 'Colters Secret Blend',
        smokingTime: 12,
        allergens: ['none'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
    {
        id: 'pulled-pork-001',
        name: 'Colters Pulled Pork',
        description: 'Applewood smoked pork shoulder with Colters tangy BBQ sauce',
        category: 'pork',
        status: 'available',
        price: 14.99,
        weight: 8,
        inventory: 32,
        minOrder: 3,
        maxOrder: 25,
        woodType: 'applewood',
        spiceRub: 'Colters BBQ Rub',
        smokingTime: 10,
        allergens: ['none'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
    {
        id: 'ribs-001',
        name: 'Colters St. Louis Ribs',
        description: 'Maple glazed ribs with Colters signature dry rub',
        category: 'pork',
        status: 'available',
        price: 22.99,
        weight: 6,
        inventory: 18,
        minOrder: 2,
        maxOrder: 15,
        woodType: 'maple',
        spiceRub: 'Colters Rib Rub',
        smokingTime: 6,
        allergens: ['none'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
    {
        id: 'sausage-001',
        name: 'Colters House Sausage',
        description: 'Traditional pork sausage with Colters secret seasoning blend',
        category: 'pork',
        status: 'available',
        price: 8.99,
        weight: 1,
        inventory: 67,
        minOrder: 4,
        maxOrder: 50,
        woodType: 'hickory',
        spiceRub: 'Colters Sausage Blend',
        smokingTime: 4,
        allergens: ['pork'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
    {
        id: 'turkey-001',
        name: 'Colters Smoked Turkey',
        description: 'Cherry smoked turkey breast with herbs and citrus',
        category: 'poultry',
        status: 'available',
        price: 16.99,
        weight: 4,
        inventory: 23,
        minOrder: 1,
        maxOrder: 10,
        woodType: 'cherry',
        spiceRub: 'Colters Poultry Rub',
        smokingTime: 8,
        allergens: ['none'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
    {
        id: 'brisket-burnt-001',
        name: 'Colters Burnt Ends',
        description: 'Cubed brisket point with extra smoke and Colters sweet glaze',
        category: 'beef',
        status: 'available',
        price: 19.99,
        weight: 2,
        inventory: 12,
        minOrder: 2,
        maxOrder: 12,
        woodType: 'hickory',
        spiceRub: 'Colters Secret Blend',
        smokingTime: 14,
        allergens: ['none'],
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-12T00:00:00Z',
    },
];

const COLTERS_CUSTOMERS: Customer[] = [
    {
        id: 'cust-001',
        name: 'Joe\'s BBQ Shack',
        email: 'joe@joesbbq.com',
        phone: '555-0123',
        address: '123 Main St, Anytown, USA 12345',
        type: 'restaurant',
        notes: 'Long-time customer, always pays on time',
        totalOrders: 45,
        totalSpent: 12450.00,
        createdAt: '2024-02-01T00:00:00Z',
    },
    {
        id: 'cust-002',
        name: 'Suzie\'s Restaurant',
        email: 'suzie@suziesrestaurant.com',
        phone: '555-0456',
        address: '456 Oak Ave, Anytown, USA 12345',
        type: 'restaurant',
        notes: 'Health-conscious menu, appreciates nutritional info',
        totalOrders: 28,
        totalSpent: 8750.00,
        createdAt: '2024-02-15T00:00:00Z',
    },
];

const COLTERS_ORDERS: Order[] = [
    {
        id: 'order-001',
        customerId: 'cust-001',
        items: [
            { productId: 'brisket-001', quantity: 5, price: 18.99 },
            { productId: 'ribs-001', quantity: 3, price: 22.99 },
        ],
        status: 'confirmed',
        total: 156.92,
        orderDate: '2024-03-12',
        deliveryDate: '2024-03-15',
        deliveryMethod: 'delivery',
        notes: 'Extra spice rub on brisket',
        paymentStatus: 'paid',
    },
];

const COLTERS_SCHEDULES: SmokingSchedule[] = [
    {
        id: 'schedule-001',
        productId: 'brisket-001',
        quantity: 45,
        startTime: '2024-03-12T06:00:00Z',
        endTime: '2024-03-12T18:00:00Z',
        status: 'in_progress',
        temperature: 225,
        woodType: 'hickory',
        notes: '14-day dry aged brisket, extra spice rub',
        smoker: 'Mike',
    },
];

export default function SmokehouseOperationsModule() {
    const [activeTab, setActiveTab] = useState('products');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    const filteredProducts = COLTERS_PRODUCTS.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Flame className="w-6 h-6 text-orange-600" />
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Colters Smokehouse</h1>
                            <p className="text-sm text-gray-500">Operations Management</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                            <Plus className="w-4 h-4 mr-2" />
                            New Order
                        </button>
                        <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="bg-white border-b border-gray-200">
                <div className="flex gap-8 px-6">
                    {[
                        { id: 'products', label: 'Products', icon: Package },
                        { id: 'customers', label: 'Customers', icon: Users },
                        { id: 'orders', label: 'Orders', icon: ShoppingCart },
                        { id: 'schedule', label: 'Schedule', icon: Calendar },
                        { id: 'compliance', label: 'Compliance', icon: ClipboardList },
                    ].map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-2 py-3 border-b-2 transition-colors ${activeTab === id
                                ? 'border-orange-500 text-orange-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="font-medium">{label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto">
                {activeTab === 'products' && (
                    <div className="p-6">
                        <div className="mb-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Colters Products</h2>
                            <div className="flex items-center gap-4 mb-4">
                                <div className="flex-1 relative">
                                    <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                    />
                                </div>
                                <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Product
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredProducts.map(product => (
                                <div key={product.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Drumstick className="w-5 h-5 text-orange-600" />
                                            <h3 className="font-semibold text-gray-900">{product.name}</h3>
                                        </div>
                                    </div>

                                    <p className="text-sm text-gray-600 mb-3">{product.description}</p>

                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Price:</span>
                                            <span className="font-medium">${product.price}/lb</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Inventory:</span>
                                            <span className={`font-medium ${product.inventory < 20 ? 'text-red-600' : 'text-green-600'
                                                }`}>
                                                {product.inventory} lbs
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Wood:</span>
                                            <span className="font-medium">{product.woodType}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Smoke Time:</span>
                                            <span className="font-medium">{product.smokingTime} hrs</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200">
                                        <button
                                            onClick={() => setSelectedProduct(product)}
                                            className="text-orange-600 hover:text-orange-700 text-sm font-medium"
                                        >
                                            View Details
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'customers' && (
                    <div className="p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Colters Customers</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {COLTERS_CUSTOMERS.map(customer => (
                                <div key={customer.id} className="bg-white rounded-lg border border-gray-200 p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{customer.name}</h3>
                                            <p className="text-sm text-gray-500">{customer.type}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Users className="w-4 h-4" />
                                            <span>{customer.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Phone className="w-4 h-4" />
                                            <span>{customer.phone}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Mail className="w-4 h-4" />
                                            <span>{customer.email}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <MapPin className="w-4 h-4" />
                                            <span>{customer.address}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-3 border-t border-gray-200">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Orders:</span>
                                            <span className="font-medium">{customer.totalOrders}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Total Spent:</span>
                                            <span className="font-medium">${customer.totalSpent.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'orders' && (
                    <div className="p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Orders</h2>
                        <div className="space-y-4">
                            {COLTERS_ORDERS.map(order => (
                                <div key={order.id} className="bg-white rounded-lg border border-gray-200 p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <h3 className="font-semibold text-gray-900">Order #{order.id}</h3>
                                            <p className="text-sm text-gray-500">
                                                {COLTERS_CUSTOMERS.find(c => c.id === order.customerId)?.name}
                                            </p>
                                        </div>
                                        <span className={`px-2 py-1 text-xs rounded-full ${order.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {order.status}
                                        </span>
                                    </div>

                                    <div className="space-y-2 mb-3">
                                        {order.items.map((item, index) => {
                                            const product = COLTERS_PRODUCTS.find(p => p.id === item.productId);
                                            return (
                                                <div key={index} className="flex justify-between text-sm">
                                                    <span>{product?.name} ({item.quantity} lbs)</span>
                                                    <span>${(item.price * item.quantity).toFixed(2)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                                        <span className="font-semibold">Total: ${order.total.toFixed(2)}</span>
                                        <div className="flex gap-2">
                                            <button className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                                                Edit
                                            </button>
                                            <button className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                                                Complete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'schedule' && (
                    <div className="p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Smoking Schedule</h2>
                        <div className="space-y-4">
                            {COLTERS_SCHEDULES.map(schedule => {
                                const product = COLTERS_PRODUCTS.find(p => p.id === schedule.productId);
                                return (
                                    <div key={schedule.id} className="bg-white rounded-lg border border-gray-200 p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 className="font-semibold text-gray-900">{product?.name}</h3>
                                                <p className="text-sm text-gray-500">Quantity: {schedule.quantity} lbs</p>
                                            </div>
                                            <span className={`px-2 py-1 text-xs rounded-full ${schedule.status === 'in_progress' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {schedule.status}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                            <div>
                                                <span className="text-gray-500">Start:</span>
                                                <p className="font-medium">{new Date(schedule.startTime).toLocaleString()}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">End:</span>
                                                <p className="font-medium">{new Date(schedule.endTime).toLocaleString()}</p>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Temperature:</span>
                                                <p className="font-medium">{schedule.temperature}°F</p>
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-gray-200">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Flame className="w-4 h-4" />
                                                    <span>Wood: {schedule.woodType}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Users className="w-4 h-4" />
                                                    <span>Smoker: {schedule.smoker}</span>
                                                </div>
                                            </div>
                                            {schedule.notes && (
                                                <p className="text-sm text-gray-600 mt-2">{schedule.notes}</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'compliance' && (
                    <div className="p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance & Safety</h2>
                        <div className="text-center text-gray-500 py-8">
                            <ClipboardList className="w-12 h-12 mx-auto mb-2" />
                            <p>Compliance tracking coming soon...</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}