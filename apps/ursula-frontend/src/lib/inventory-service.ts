/**
 * Inventory Service for Colters Smokehouse
 * 
 * Handles order-to-inventory automatic linkage logic for Colters operations.
 */

export interface InventoryTransaction {
    id: string;
    productId: string;
    type: 'reserve' | 'consume' | 'add' | 'waste';
    quantity: number;
    timestamp: string;
    orderId?: string;
    notes?: string;
}

export interface InventoryReservation {
    id: string;
    productId: string;
    orderId: string;
    quantity: number;
    timestamp: string;
    status: 'active' | 'fulfilled' | 'expired';
}

export interface InventoryAlert {
    id: string;
    productId: string;
    type: 'low_stock' | 'out_of_stock' | 'overstock';
    message: string;
    timestamp: string;
    resolved: boolean;
}

// Mock inventory service functions
export const reserveInventory = (productId: string, quantity: number, orderId: string): InventoryTransaction => {
    return {
        id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId,
        type: 'reserve',
        quantity,
        timestamp: new Date().toISOString(),
        orderId,
        notes: 'Inventory reserved for order'
    };
};

export const consumeInventory = (productId: string, quantity: number, orderId: string): InventoryTransaction => {
    return {
        id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId,
        type: 'consume',
        quantity,
        timestamp: new Date().toISOString(),
        orderId,
        notes: 'Inventory consumed for completed order'
    };
};

export const addInventory = (productId: string, quantity: number, source: string): InventoryTransaction => {
    return {
        id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId,
        type: 'add',
        quantity,
        timestamp: new Date().toISOString(),
        notes: `Inventory added from ${source}`
    };
};

export const recordWaste = (productId: string, quantity: number, reason: string): InventoryTransaction => {
    return {
        id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId,
        type: 'waste',
        quantity,
        timestamp: new Date().toISOString(),
        notes: `Waste recorded: ${reason}`
    };
};

export const createInventoryAlert = (productId: string, type: 'low_stock' | 'out_of_stock' | 'overstock', message: string): InventoryAlert => {
    return {
        id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productId,
        type,
        message,
        timestamp: new Date().toISOString(),
        resolved: false
    };
};