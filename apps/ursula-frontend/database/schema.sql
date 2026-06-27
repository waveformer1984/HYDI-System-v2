/**
 * Colters Smokehouse - Database Schema
 * 
 * PostgreSQL schema for smokehouse operations and cultures management.
 * Includes tables, indexes, relationships, and sample queries.
 * 
 * Usage: Run this SQL script to set up the database structure.
 * Version: PostgreSQL 14+
 */

-- ==================== CORE TABLES ====================

-- Products table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('beef', 'pork', 'poultry', 'lamb', 'fish', 'specialty', 'sides', 'sauces')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('available', 'smoking', 'curing', 'out_of_stock', 'discontinued')),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    weight DECIMAL(8,2) NOT NULL CHECK (weight > 0),
    description TEXT,
    smoking_time INTEGER NOT NULL CHECK (smoking_time > 0), -- in hours
    wood_type VARCHAR(100) NOT NULL,
    spice_rub VARCHAR(100) NOT NULL,
    inventory INTEGER NOT NULL DEFAULT 0 CHECK (inventory >= 0),
    min_order INTEGER NOT NULL CHECK (min_order > 0),
    max_order INTEGER NOT NULL CHECK (max_order > 0),
    allergens TEXT[], -- array of allergen strings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Customers table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    address TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('retail', 'wholesale', 'restaurant')),
    notes TEXT,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_spent DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
    total DECIMAL(12,2) NOT NULL CHECK (total >= 0),
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivery_date TIMESTAMP WITH TIME ZONE NOT NULL,
    delivery_method VARCHAR(50) NOT NULL CHECK (delivery_method IN ('pickup', 'delivery', 'shipping')),
    notes TEXT,
    payment_status VARCHAR(50) NOT NULL CHECK (payment_status IN ('paid', 'pending', 'refunded')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order items table
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Smoking schedules table
CREATE TABLE smoking_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity DECIMAL(8,2) NOT NULL CHECK (quantity > 0),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cooling', 'finished')),
    temperature DECIMAL(5,2) NOT NULL CHECK (temperature > 0),
    humidity DECIMAL(5,2) CHECK (humidity >= 0 AND humidity <= 100),
    wood_type VARCHAR(100) NOT NULL,
    notes TEXT,
    smoker VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compliance records table
CREATE TABLE compliance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(100) NOT NULL CHECK (type IN ('health_inspection', 'food_safety', 'temperature_log', 'cleaning')),
    date DATE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pass', 'fail', 'pending')),
    inspector VARCHAR(255),
    notes TEXT NOT NULL,
    next_due DATE NOT NULL,
    attachments TEXT[], -- array of file paths
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== CULTURES TABLES ====================

-- Cultures table
CREATE TABLE cultures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('starter', 'brine', 'rub', 'sauce', 'pickle', 'cure', 'marinade', 'injection')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'dormant', 'contaminated', 'expired', 'preparing', 'fermenting')),
    description TEXT,
    origin VARCHAR(255),
    source VARCHAR(255),
    acquisition_date DATE,
    expiration_date DATE,
    storage_conditions TEXT,
    optimal_temp DECIMAL(5,2) CHECK (optimal_temp > 0),
    optimal_ph DECIMAL(4,2) CHECK (optimal_ph > 0 AND optimal_ph <= 14),
    current_ph DECIMAL(4,2) CHECK (current_ph > 0 AND current_ph <= 14),
    current_temp DECIMAL(5,2) CHECK (current_temp > 0),
    ingredients TEXT[],
    allergens TEXT[],
    usage TEXT[],
    yield VARCHAR(255),
    preparation_time INTEGER CHECK (preparation_time >= 0), -- in hours
    fermentation_time INTEGER CHECK (fermentation_time >= 0), -- in hours
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    batch_count INTEGER DEFAULT 0 CHECK (batch_count >= 0),
    success_rate DECIMAL(5,2) CHECK (success_rate >= 0 AND success_rate <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fermentation batches table
CREATE TABLE fermentation_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    culture_id UUID NOT NULL REFERENCES cultures(id) ON DELETE RESTRICT,
    batch_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('initial', 'active', 'peak', 'declining', 'complete')),
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expected_end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    actual_end_date TIMESTAMP WITH TIME ZONE,
    initial_ph DECIMAL(4,2) NOT NULL CHECK (initial_ph > 0 AND initial_ph <= 14),
    current_ph DECIMAL(4,2) NOT NULL CHECK (current_ph > 0 AND current_ph <= 14),
    target_ph DECIMAL(4,2) NOT NULL CHECK (target_ph > 0 AND target_ph <= 14),
    temperature DECIMAL(5,2) NOT NULL CHECK (temperature > 0),
    humidity DECIMAL(5,2) CHECK (humidity >= 0 AND humidity <= 100),
    vessel VARCHAR(255) NOT NULL,
    volume DECIMAL(8,2) NOT NULL CHECK (volume > 0), -- in liters
    notes TEXT,
    success BOOLEAN,
    yield VARCHAR(255),
    quality VARCHAR(50) CHECK (quality IN ('excellent', 'good', 'fair', 'poor')),
    issues TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Batch ingredients table
CREATE TABLE batch_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES fermentation_batches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    unit VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('base', 'culture', 'additive', 'flavor')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Measurements table
CREATE TABLE measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES fermentation_batches(id) ON DELETE CASCADE,
    culture_id UUID REFERENCES cultures(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('ph', 'temperature', 'salinity', 'brix', 'specific_gravity', 'acidity')),
    value DECIMAL(10,4) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recipes table
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('starter', 'brine', 'rub', 'sauce', 'pickle', 'cure', 'marinade', 'injection')),
    description TEXT,
    culture_id UUID REFERENCES cultures(id) ON DELETE SET NULL,
    prep_time INTEGER NOT NULL CHECK (prep_time >= 0), -- in minutes
    ferment_time INTEGER NOT NULL CHECK (ferment_time >= 0), -- in hours
    difficulty VARCHAR(50) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    servings INTEGER NOT NULL CHECK (servings > 0),
    instructions TEXT[] NOT NULL,
    tips TEXT[],
    variations TEXT[],
    storage TEXT NOT NULL,
    shelf_life VARCHAR(255) NOT NULL,
    rating DECIMAL(3,2) CHECK (rating >= 1 AND rating <= 5),
    reviews INTEGER DEFAULT 0 CHECK (reviews >= 0),
    author VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recipe ingredients table
CREATE TABLE recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    unit VARCHAR(50) NOT NULL,
    notes TEXT,
    optional BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Culture activity logs table
CREATE TABLE culture_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    culture_id UUID NOT NULL REFERENCES cultures(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES fermentation_batches(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'fed', 'split', 'harvested', 'discarded', 'contaminated', 'tested')),
    details TEXT NOT NULL,
    performed_by VARCHAR(255) NOT NULL,
    notes TEXT,
    attachments TEXT[], -- array of file paths
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== INDEXES ====================

-- Products indexes
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_name ON products USING gin(to_tsvector('english', name));

-- Customers indexes
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_type ON customers(type);
CREATE INDEX idx_customers_name ON customers USING gin(to_tsvector('english', name));

-- Orders indexes
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_order_date ON orders(order_date);
CREATE INDEX idx_orders_delivery_date ON orders(delivery_date);

-- Smoking schedules indexes
CREATE INDEX idx_smoking_schedules_product_id ON smoking_schedules(product_id);
CREATE INDEX idx_smoking_schedules_status ON smoking_schedules(status);
CREATE INDEX idx_smoking_schedules_start_time ON smoking_schedules(start_time);

-- Cultures indexes
CREATE INDEX idx_cultures_category ON cultures(category);
CREATE INDEX idx_cultures_status ON cultures(status);
CREATE INDEX idx_cultures_name ON cultures USING gin(to_tsvector('english', name));

-- Fermentation batches indexes
CREATE INDEX idx_fermentation_batches_culture_id ON fermentation_batches(culture_id);
CREATE INDEX idx_fermentation_batches_status ON fermentation_batches(status);
CREATE INDEX idx_fermentation_batches_start_date ON fermentation_batches(start_date);

-- Measurements indexes
CREATE INDEX idx_measurements_batch_id ON measurements(batch_id);
CREATE INDEX idx_measurements_culture_id ON measurements(culture_id);
CREATE INDEX idx_measurements_timestamp ON measurements(timestamp);

-- ==================== TRIGGERS ====================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_smoking_schedules_updated_at BEFORE UPDATE ON smoking_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_compliance_records_updated_at BEFORE UPDATE ON compliance_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cultures_updated_at BEFORE UPDATE ON cultures FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fermentation_batches_updated_at BEFORE UPDATE ON fermentation_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recipes_updated_at BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== VIEWS ====================

-- Products with inventory status view
CREATE VIEW product_inventory_view AS
SELECT 
    p.*,
    CASE 
        WHEN p.inventory = 0 THEN 'out_of_stock'
        WHEN p.inventory <= p.min_order THEN 'low_stock'
        WHEN p.inventory >= p.max_order * 2 THEN 'overstocked'
        ELSE 'normal'
    END as inventory_status,
    COALESCE(SUM(oi.quantity), 0) as total_ordered
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
GROUP BY p.id;

-- Customer summary view
CREATE VIEW customer_summary_view AS
SELECT 
    c.*,
    COUNT(o.id) as order_count,
    COALESCE(SUM(o.total), 0) as total_revenue,
    AVG(o.total) as average_order_value,
    MAX(o.order_date) as last_order_date,
    CASE 
        WHEN MAX(o.order_date) >= CURRENT_DATE - INTERVAL '30 days' THEN 'active'
        WHEN MAX(o.order_date) >= CURRENT_DATE - INTERVAL '90 days' THEN 'recent'
        ELSE 'inactive'
    END as activity_status
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id AND o.status = 'completed'
GROUP BY c.id;

-- ==================== SAMPLE QUERIES ====================

-- Get low inventory products
/*
SELECT name, inventory, min_order, max_order 
FROM products 
WHERE inventory <= min_order 
AND status = 'available'
ORDER BY inventory ASC;
*/

-- Get customer spending trends
/*
SELECT 
    DATE_TRUNC('month', order_date) as month,
    COUNT(*) as order_count,
    SUM(total) as revenue,
    AVG(total) as average_order
FROM orders 
WHERE status = 'completed'
AND order_date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', order_date)
ORDER BY month DESC;
*/

-- Get culture performance metrics
/*
SELECT 
    c.name,
    c.category,
    COUNT(fb.id) as batch_count,
    AVG(CASE WHEN fb.success THEN 100 ELSE 0 END) as success_rate,
    AVG(fb.quality_score) as avg_quality
FROM cultures c
LEFT JOIN fermentation_batches fb ON c.id = fb.culture_id
WHERE c.status = 'active'
GROUP BY c.id, c.name, c.category
ORDER BY success_rate DESC;
*/
