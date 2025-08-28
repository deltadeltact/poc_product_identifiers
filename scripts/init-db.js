const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Initializing database...');

db.serialize(() => {
    // Product versions table
    db.run(`
        CREATE TABLE IF NOT EXISTS product_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ean TEXT,
            tracking_mode TEXT NOT NULL DEFAULT 'none' 
                CHECK (tracking_mode IN ('none', 'imei', 'serial')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Device identifiers table
    db.run(`
        CREATE TABLE IF NOT EXISTS device_identifiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_version_id INTEGER NOT NULL,
            original_product_version_id INTEGER,
            delivery_id INTEGER,
            imei TEXT,
            serial_number TEXT,
            original_imei TEXT,
            original_serial_number TEXT,
            status TEXT NOT NULL DEFAULT 'in_stock' 
                CHECK (status IN ('in_stock', 'sold', 'defective', 'missing', 'reserved', 'defective_at_delivery', 'returned_to_supplier', 'written_off')),
            is_clearance BOOLEAN DEFAULT FALSE,
            clearance_price DECIMAL(10,2),
            clearance_reason TEXT,
            purchase_price DECIMAL(10,2),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_version_id) REFERENCES product_versions (id),
            FOREIGN KEY (original_product_version_id) REFERENCES product_versions (id),
            FOREIGN KEY (delivery_id) REFERENCES deliveries (id),
            UNIQUE(imei),
            UNIQUE(serial_number)
        )
    `);

    // Status history table
    db.run(`
        CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_identifier_id INTEGER NOT NULL,
            old_status TEXT,
            new_status TEXT NOT NULL,
            changed_by TEXT NOT NULL DEFAULT 'system',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_identifier_id) REFERENCES device_identifiers (id)
        )
    `);

    // Product version swap history table
    db.run(`
        CREATE TABLE IF NOT EXISTS product_version_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_identifier_id INTEGER NOT NULL,
            old_product_version_id INTEGER NOT NULL,
            new_product_version_id INTEGER NOT NULL,
            changed_by TEXT NOT NULL DEFAULT 'system',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_identifier_id) REFERENCES device_identifiers (id),
            FOREIGN KEY (old_product_version_id) REFERENCES product_versions (id),
            FOREIGN KEY (new_product_version_id) REFERENCES product_versions (id)
        )
    `);

    // Identifier swap history table
    db.run(`
        CREATE TABLE IF NOT EXISTS identifier_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_identifier_id INTEGER NOT NULL,
            old_imei TEXT,
            new_imei TEXT,
            old_serial_number TEXT,
            new_serial_number TEXT,
            changed_by TEXT NOT NULL DEFAULT 'system',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_identifier_id) REFERENCES device_identifiers (id)
        )
    `);

    // Deliveries table
    db.run(`
        CREATE TABLE IF NOT EXISTS deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_number TEXT NOT NULL UNIQUE,
            delivery_date DATE NOT NULL,
            supplier TEXT,
            status TEXT NOT NULL DEFAULT 'concept' 
                CHECK (status IN ('concept', 'booked', 'partially_booked')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Delivery lines table
    db.run(`
        CREATE TABLE IF NOT EXISTS delivery_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id INTEGER NOT NULL,
            product_version_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            purchase_price_per_unit DECIMAL(10,2) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (delivery_id) REFERENCES deliveries (id),
            FOREIGN KEY (product_version_id) REFERENCES product_versions (id)
        )
    `);

    // Bulk stock table for non-tracked products
    db.run(`
        CREATE TABLE IF NOT EXISTS bulk_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_version_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_version_id) REFERENCES product_versions (id),
            UNIQUE(product_version_id)
        )
    `);

    // Bulk stock history table
    db.run(`
        CREATE TABLE IF NOT EXISTS bulk_stock_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_version_id INTEGER NOT NULL,
            old_quantity INTEGER NOT NULL,
            new_quantity INTEGER NOT NULL,
            change_quantity INTEGER NOT NULL,
            changed_by TEXT NOT NULL DEFAULT 'system',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_version_id) REFERENCES product_versions (id)
        )
    `);

    // Clearance history table
    db.run(`
        CREATE TABLE IF NOT EXISTS clearance_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_identifier_id INTEGER NOT NULL,
            old_is_clearance BOOLEAN,
            new_is_clearance BOOLEAN NOT NULL,
            old_clearance_price DECIMAL(10,2),
            new_clearance_price DECIMAL(10,2),
            old_clearance_reason TEXT,
            new_clearance_reason TEXT,
            changed_by TEXT NOT NULL DEFAULT 'admin',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_identifier_id) REFERENCES device_identifiers (id)
        )
    `);

    console.log('Database schema created successfully!');
    
    // Insert some sample data
    console.log('Inserting sample data...');
    
    // Sample product versions - Mobile Retail Focus
    db.run(`INSERT OR IGNORE INTO product_versions (id, name, ean, tracking_mode) VALUES 
        -- Phones (IMEI tracking)
        (1, 'iPhone 15 Pro 128GB Space Black', '1234567890101', 'imei'),
        (2, 'iPhone 15 256GB Blue', '1234567890102', 'imei'),
        (3, 'Samsung Galaxy S24 128GB Phantom Black', '1234567890103', 'imei'),
        (4, 'Samsung Galaxy S24 Ultra 256GB Titanium Gray', '1234567890104', 'imei'),
        (5, 'Xiaomi 14 256GB Jade Green', '1234567890105', 'imei'),
        -- Audio devices (Serial tracking)
        (6, 'AirPods Pro 2nd Gen USB-C', '1234567890106', 'serial'),
        -- Smartwatches (Serial tracking)
        (7, 'Apple Watch Series 9 45mm Midnight', '1234567890107', 'serial'),
        (8, 'Samsung Galaxy Watch 6 44mm Silver', '1234567890108', 'serial'),
        -- Accessories (No tracking - bulk)
        (9, 'Screen Protector Tempered Glass Universal', '1234567890109', 'none'),
        (10, 'Phone Case Clear Silicone Universal', '1234567890110', 'none')
    `);

    // Sample deliveries
    db.run(`INSERT OR IGNORE INTO deliveries (id, delivery_number, delivery_date, supplier, status) VALUES 
        (1, 'WS0001', '2025-01-10', 'Apple Distribution Europe', 'booked'),
        (2, 'WS0002', '2025-01-12', 'Samsung Electronics Benelux', 'booked'),
        (3, 'WS0003', '2025-01-15', 'Xiaomi Global Distribution', 'booked')
    `);

    // Sample delivery lines with purchase prices
    db.run(`INSERT OR IGNORE INTO delivery_lines (id, delivery_id, product_version_id, quantity, purchase_price_per_unit) VALUES 
        -- Apple Delivery (WS0001)
        (1, 1, 1, 5, 899.00),   -- iPhone 15 Pro
        (2, 1, 2, 3, 799.00),   -- iPhone 15
        (3, 1, 6, 4, 249.00),   -- AirPods Pro
        (4, 1, 7, 2, 399.00),   -- Apple Watch
        -- Samsung Delivery (WS0002)  
        (5, 2, 3, 4, 849.00),   -- Galaxy S24
        (6, 2, 4, 2, 1199.00),  -- Galaxy S24 Ultra
        (7, 2, 8, 3, 299.00),   -- Galaxy Watch
        -- Xiaomi Delivery (WS0003)
        (8, 3, 5, 6, 699.00),   -- Xiaomi 14
        (9, 3, 9, 50, 12.99),   -- Screen Protectors  
        (10, 3, 10, 30, 19.99)  -- Phone Cases
    `);

    // Sample device identifiers with delivery links and purchase prices
    db.run(`INSERT OR IGNORE INTO device_identifiers (
        product_version_id, original_product_version_id, delivery_id, 
        imei, serial_number, original_imei, original_serial_number, 
        status, received_damaged, damage_description, purchase_price
    ) VALUES 
        -- iPhone 15 Pro from WS0001 (IMEI tracking)
        (1, 1, 1, '351234567890101', NULL, '351234567890101', NULL, 'in_stock', 0, NULL, 899.00),
        (1, 1, 1, '351234567890102', NULL, '351234567890102', NULL, 'in_stock', 0, NULL, 899.00),
        (1, 1, 1, '351234567890103', NULL, '351234567890103', NULL, 'defective_at_delivery', 1, 'Screen cracked during shipping', 899.00),
        (1, 1, 1, '351234567890104', NULL, '351234567890104', NULL, 'in_stock', 0, NULL, 899.00),
        (1, 1, 1, '351234567890105', NULL, '351234567890105', NULL, 'sold', 0, NULL, 899.00),
        -- iPhone 15 from WS0001 (IMEI tracking)
        (2, 2, 1, '351234567890201', NULL, '351234567890201', NULL, 'in_stock', 0, NULL, 799.00),
        (2, 2, 1, '351234567890202', NULL, '351234567890202', NULL, 'in_stock', 0, NULL, 799.00),
        (2, 2, 1, '351234567890203', NULL, '351234567890203', NULL, 'in_stock', 0, NULL, 799.00),
        -- Galaxy S24 from WS0002 (IMEI tracking)
        (3, 3, 2, '351234567890301', NULL, '351234567890301', NULL, 'in_stock', 0, NULL, 849.00),
        (3, 3, 2, '351234567890302', NULL, '351234567890302', NULL, 'in_stock', 0, NULL, 849.00),
        (3, 3, 2, '351234567890303', NULL, '351234567890303', NULL, 'sold', 0, NULL, 849.00),
        (3, 3, 2, '351234567890304', NULL, '351234567890304', NULL, 'in_stock', 0, NULL, 849.00),
        -- Galaxy S24 Ultra from WS0002 (IMEI tracking)
        (4, 4, 2, '351234567890401', NULL, '351234567890401', NULL, 'in_stock', 0, NULL, 1199.00),
        (4, 4, 2, '351234567890402', NULL, '351234567890402', NULL, 'defective_at_delivery', 1, 'Minor scratches on back panel', 1199.00),
        -- Xiaomi 14 from WS0003 (IMEI tracking)
        (5, 5, 3, '351234567890501', NULL, '351234567890501', NULL, 'in_stock', 0, NULL, 699.00),
        (5, 5, 3, '351234567890502', NULL, '351234567890502', NULL, 'in_stock', 0, NULL, 699.00),
        (5, 5, 3, '351234567890503', NULL, '351234567890503', NULL, 'in_stock', 0, NULL, 699.00),
        (5, 5, 3, '351234567890504', NULL, '351234567890504', NULL, 'reserved', 0, NULL, 699.00),
        (5, 5, 3, '351234567890505', NULL, '351234567890505', NULL, 'in_stock', 0, NULL, 699.00),
        (5, 5, 3, '351234567890506', NULL, '351234567890506', NULL, 'sold', 0, NULL, 699.00),
        -- AirPods Pro from WS0001 (Serial tracking)
        (6, 6, 1, NULL, 'AP2UC24001', NULL, 'AP2UC24001', 'in_stock', 0, NULL, 249.00),
        (6, 6, 1, NULL, 'AP2UC24002', NULL, 'AP2UC24002', 'in_stock', 0, NULL, 249.00),
        (6, 6, 1, NULL, 'AP2UC24003', NULL, 'AP2UC24003', 'sold', 0, NULL, 249.00),
        (6, 6, 1, NULL, 'AP2UC24004', NULL, 'AP2UC24004', 'defective_at_delivery', 1, 'Charging case dented', 249.00),
        -- Apple Watch Series 9 from WS0001 (Serial tracking)
        (7, 7, 1, NULL, 'AW9S44001', NULL, 'AW9S44001', 'in_stock', 0, NULL, 399.00),
        (7, 7, 1, NULL, 'AW9S44002', NULL, 'AW9S44002', 'sold', 0, NULL, 399.00),
        -- Galaxy Watch 6 from WS0002 (Serial tracking)
        (8, 8, 2, NULL, 'GW6S44001', NULL, 'GW6S44001', 'in_stock', 0, NULL, 299.00),
        (8, 8, 2, NULL, 'GW6S44002', NULL, 'GW6S44002', 'in_stock', 0, NULL, 299.00),
        (8, 8, 2, NULL, 'GW6S44003', NULL, 'GW6S44003', 'missing', 0, NULL, 299.00)
    `);

    // Create initial status history for ALL identifiers - they all start as 'in_stock' when delivered
    db.run(`
        INSERT OR IGNORE INTO status_history (device_identifier_id, old_status, new_status, changed_by, note)
        SELECT 
            di.id,
            NULL as old_status,
            'in_stock' as new_status,
            'system' as changed_by,
            'Ingeboekt via levering ' || d.delivery_number as note
        FROM device_identifiers di
        JOIN deliveries d ON di.delivery_id = d.id
    `);

    // Add additional status changes for items that are no longer in_stock
    db.run(`INSERT OR IGNORE INTO status_history (device_identifier_id, old_status, new_status, changed_by, note) VALUES 
        -- Items that were sold
        (3, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        (11, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        (18, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        -- Items with other status changes
        (8, 'in_stock', 'reserved', 'admin', 'Gereserveerd voor klant'),
        (15, 'in_stock', 'defective', 'admin', 'Scherm beschadigd bij controle'),
        (22, 'in_stock', 'missing', 'admin', 'Niet gevonden bij inventarisatie')
    `);

    // Sample bulk stock for non-tracked products
    db.run(`INSERT OR IGNORE INTO bulk_stock (product_version_id, quantity) VALUES 
        (9, 45),   -- Screen Protectors (5 sold from original 50)
        (10, 27)   -- Phone Cases (3 sold from original 30)
    `);

    // Sample bulk stock history  
    db.run(`INSERT OR IGNORE INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note) VALUES 
        (9, 0, 50, 50, 'system', 'Delivery booking WS0003'),
        (9, 50, 45, -5, 'admin', 'Verkoop aan klanten'),
        (10, 0, 30, 30, 'system', 'Delivery booking WS0003'),
        (10, 30, 27, -3, 'admin', 'Verkoop aan klanten')
    `);

    console.log('Sample data inserted successfully!');
});

db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
    console.log('Database initialization completed!');
    process.exit(0);
});