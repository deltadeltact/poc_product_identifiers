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
                CHECK (status IN ('in_stock', 'sold', 'defective', 'missing', 'reserved')),
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
        (5, 'Google Pixel 8 Pro 128GB Bay Blue', '1234567890105', 'imei'),
        -- Smartwatches (Serial tracking)
        (6, 'Apple Watch Series 9 45mm Midnight', '1234567890106', 'serial'),
        (7, 'Samsung Galaxy Watch 6 44mm Silver', '1234567890107', 'serial'),
        (8, 'Apple Watch SE 40mm Starlight', '1234567890108', 'serial'),
        -- Accessories (No tracking - bulk)
        (9, 'AirPods Pro 3rd Gen', '1234567890109', 'none'),
        (10, 'iPhone 15 Pro Silicone Case Black', '1234567890110', 'none'),
        (11, 'iPhone 15 Screen Protector Tempered Glass', '1234567890111', 'none'),
        (12, 'Samsung Galaxy S24 Clear Case', '1234567890112', 'none'),
        (13, 'USB-C to Lightning Cable 1m', '1234567890113', 'none')
    `);

    // Sample deliveries
    db.run(`INSERT OR IGNORE INTO deliveries (id, delivery_number, delivery_date, supplier, status) VALUES 
        (1, 'WS0001', '2025-01-10', 'Apple Distribution Europe', 'booked'),
        (2, 'WS0002', '2025-01-12', 'Samsung Electronics Benelux', 'booked'),
        (3, 'WS0003', '2025-01-15', 'Mobile Accessories Wholesale', 'booked')
    `);

    // Sample delivery lines with purchase prices
    db.run(`INSERT OR IGNORE INTO delivery_lines (id, delivery_id, product_version_id, quantity, purchase_price_per_unit) VALUES 
        -- Apple Delivery (WS0001)
        (1, 1, 1, 15, 899.00),  -- iPhone 15 Pro 128GB
        (2, 1, 2, 12, 749.00),  -- iPhone 15 256GB
        (3, 1, 6, 8, 399.00),   -- Apple Watch Series 9
        (4, 1, 8, 6, 259.00),   -- Apple Watch SE
        (5, 1, 9, 25, 249.00),  -- AirPods Pro
        (6, 1, 10, 30, 45.00),  -- iPhone Cases
        -- Samsung Delivery (WS0002)  
        (7, 2, 3, 12, 649.00),  -- Galaxy S24
        (8, 2, 4, 8, 949.00),   -- Galaxy S24 Ultra
        (9, 2, 7, 6, 299.00),   -- Galaxy Watch 6
        (10, 2, 12, 40, 25.00), -- Samsung Cases
        -- Accessories Delivery (WS0003)
        (11, 3, 5, 10, 699.00), -- Pixel 8 Pro
        (12, 3, 11, 50, 15.00), -- Screen Protectors  
        (13, 3, 13, 30, 19.00)  -- USB-C Cables
    `);

    // Sample device identifiers with delivery links and purchase prices
    db.run(`INSERT OR IGNORE INTO device_identifiers (
        product_version_id, original_product_version_id, delivery_id, 
        imei, serial_number, original_imei, original_serial_number, 
        status, purchase_price
    ) VALUES 
        -- iPhone 15 Pro from WS0001
        (1, 1, 1, '351234567890101', NULL, '351234567890101', NULL, 'in_stock', 899.00),
        (1, 1, 1, '351234567890102', NULL, '351234567890102', NULL, 'in_stock', 899.00),
        (1, 1, 1, '351234567890103', NULL, '351234567890103', NULL, 'sold', 899.00),
        (1, 1, 1, '351234567890104', NULL, '351234567890104', NULL, 'in_stock', 899.00),
        (1, 1, 1, '351234567890105', NULL, '351234567890105', NULL, 'in_stock', 899.00),
        -- iPhone 15 from WS0001
        (2, 2, 1, '351234567890201', NULL, '351234567890201', NULL, 'in_stock', 749.00),
        (2, 2, 1, '351234567890202', NULL, '351234567890202', NULL, 'in_stock', 749.00),
        (2, 2, 1, '351234567890203', NULL, '351234567890203', NULL, 'reserved', 749.00),
        -- Galaxy S24 from WS0002
        (3, 3, 2, '351234567890301', NULL, '351234567890301', NULL, 'in_stock', 649.00),
        (3, 3, 2, '351234567890302', NULL, '351234567890302', NULL, 'in_stock', 649.00),
        (3, 3, 2, '351234567890303', NULL, '351234567890303', NULL, 'sold', 649.00),
        -- Galaxy S24 Ultra from WS0002
        (4, 4, 2, '351234567890401', NULL, '351234567890401', NULL, 'in_stock', 949.00),
        (4, 4, 2, '351234567890402', NULL, '351234567890402', NULL, 'in_stock', 949.00),
        -- Pixel 8 Pro from WS0003
        (5, 5, 3, '351234567890501', NULL, '351234567890501', NULL, 'in_stock', 699.00),
        (5, 5, 3, '351234567890502', NULL, '351234567890502', NULL, 'defective', 699.00),
        -- Apple Watch Series 9 from WS0001
        (6, 6, 1, NULL, 'AW9M45001', NULL, 'AW9M45001', 'in_stock', 399.00),
        (6, 6, 1, NULL, 'AW9M45002', NULL, 'AW9M45002', 'in_stock', 399.00),
        (6, 6, 1, NULL, 'AW9M45003', NULL, 'AW9M45003', 'sold', 399.00),
        -- Galaxy Watch 6 from WS0002
        (7, 7, 2, NULL, 'GW6S44001', NULL, 'GW6S44001', 'in_stock', 299.00),
        (7, 7, 2, NULL, 'GW6S44002', NULL, 'GW6S44002', 'in_stock', 299.00),
        -- Apple Watch SE from WS0001
        (8, 8, 1, NULL, 'AWSE40001', NULL, 'AWSE40001', 'in_stock', 259.00),
        (8, 8, 1, NULL, 'AWSE40002', NULL, 'AWSE40002', 'missing', 259.00)
    `);

    // Sample status history for all identifiers
    db.run(`INSERT OR IGNORE INTO status_history (device_identifier_id, old_status, new_status, changed_by, note) VALUES 
        (1, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (2, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (3, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        (4, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (5, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (6, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (7, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (8, 'in_stock', 'reserved', 'admin', 'Gereserveerd voor klant'),
        (9, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (10, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (11, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        (12, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (13, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (14, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0003'),
        (15, 'in_stock', 'defective', 'admin', 'Scherm beschadigd bij controle'),
        (16, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (17, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (18, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
        (19, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (20, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002'),
        (21, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
        (22, 'in_stock', 'missing', 'admin', 'Niet gevonden bij inventarisatie')
    `);

    // Sample bulk stock for non-tracked products with purchase price history
    db.run(`INSERT OR IGNORE INTO bulk_stock (product_version_id, quantity) VALUES 
        (9, 22),   -- AirPods Pro (3 sold from original 25)
        (10, 25),  -- iPhone Cases (5 sold from original 30)
        (11, 45),  -- Screen Protectors (5 sold from original 50)
        (12, 35),  -- Samsung Cases (5 sold from original 40)
        (13, 28)   -- USB-C Cables (2 sold from original 30)
    `);

    // Sample bulk stock history
    db.run(`INSERT OR IGNORE INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note) VALUES 
        (9, 0, 25, 25, 'system', 'Delivery booking WS0001'),
        (9, 25, 22, -3, 'admin', 'Verkoop aan klanten'),
        (10, 0, 30, 30, 'system', 'Delivery booking WS0001'),
        (10, 30, 25, -5, 'admin', 'Verkoop aan klanten'),
        (11, 0, 50, 50, 'system', 'Delivery booking WS0003'),
        (11, 50, 45, -5, 'admin', 'Verkoop aan klanten'),
        (12, 0, 40, 40, 'system', 'Delivery booking WS0002'),
        (12, 40, 35, -5, 'admin', 'Verkoop aan klanten'),
        (13, 0, 30, 30, 'system', 'Delivery booking WS0003'),
        (13, 30, 28, -2, 'admin', 'Verkoop aan klanten')
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