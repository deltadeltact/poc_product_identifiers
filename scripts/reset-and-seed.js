const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Resetting and seeding database...');

db.serialize(() => {
    // Clear all existing data
    console.log('Clearing existing data...');
    
    // Delete in correct order to respect foreign key constraints
    db.run(`DELETE FROM bulk_stock_history`);
    db.run(`DELETE FROM bulk_stock`);
    db.run(`DELETE FROM identifier_history`);
    db.run(`DELETE FROM product_version_history`);
    db.run(`DELETE FROM status_history`);
    db.run(`DELETE FROM delivery_lines`);
    db.run(`DELETE FROM deliveries`);
    db.run(`DELETE FROM device_identifiers`);
    db.run(`DELETE FROM product_versions`);
    
    // Reset auto-increment counters
    db.run(`DELETE FROM sqlite_sequence WHERE name IN ('product_versions', 'device_identifiers', 'deliveries', 'delivery_lines', 'status_history', 'product_version_history', 'identifier_history', 'bulk_stock', 'bulk_stock_history')`);
    
    console.log('Creating new seed data...');
    
    // Insert new product versions with specific categories
    db.run(`INSERT INTO product_versions (id, name, ean, tracking_mode) VALUES 
        -- Phones with IMEI tracking
        (1, 'iPhone 15 Pro 128GB', '8410201234567', 'imei'),
        (2, 'Samsung Galaxy S24 Ultra', '8809876543210', 'imei'),
        
        -- Electronics with serial number tracking  
        (3, 'AirPods Pro 2nd Gen', '1234567890123', 'serial'),
        (4, 'Samsung Galaxy Watch 6', '9876543210987', 'serial'),
        
        -- Phone accessories without tracking
        (5, 'Phone Case Clear', '5432167890123', 'none'),
        (6, 'Screen Protector Premium', '6789012345678', 'none')
    `);

    // Add individual identifiers for tracked products (phones and electronics)
    db.run(`INSERT INTO device_identifiers (product_version_id, imei, serial_number, status) VALUES 
        -- iPhone 15 Pro (IMEI tracking)
        (1, '351234567890001', NULL, 'in_stock'),
        
        -- Samsung Galaxy S24 Ultra (IMEI tracking)  
        (2, '351234567890002', NULL, 'in_stock'),
        
        -- AirPods Pro (Serial tracking)
        (3, NULL, 'AP2024001', 'in_stock'),
        
        -- Galaxy Watch (Serial tracking)
        (4, NULL, 'GW2024001', 'in_stock')
    `);

    // Add bulk stock for non-tracked products (accessories)
    db.run(`INSERT INTO bulk_stock (product_version_id, quantity) VALUES 
        (5, 1),  -- Phone Case Clear: 1 piece
        (6, 1)   -- Screen Protector Premium: 1 piece  
    `);

    // Add initial status history for tracked identifiers
    db.run(`INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note) VALUES 
        (1, NULL, 'in_stock', 'system', 'Initial stock'),
        (2, NULL, 'in_stock', 'system', 'Initial stock'),
        (3, NULL, 'in_stock', 'system', 'Initial stock'),
        (4, NULL, 'in_stock', 'system', 'Initial stock')
    `);

    // Add initial bulk stock history for non-tracked products
    db.run(`INSERT INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note) VALUES 
        (5, 0, 1, 1, 'system', 'Initial stock'),
        (6, 0, 1, 1, 'system', 'Initial stock')
    `);

    // Add deliveries for each product
    db.run(`INSERT INTO deliveries (id, delivery_number, delivery_date, supplier, status) VALUES 
        (1, 'WS0001', '2025-08-12', 'Apple Inc.', 'booked'),
        (2, 'WS0002', '2025-08-12', 'Samsung Electronics', 'booked'),
        (3, 'WS0003', '2025-08-12', 'Apple Inc.', 'booked'),
        (4, 'WS0004', '2025-08-12', 'Samsung Electronics', 'booked'),
        (5, 'WS0005', '2025-08-12', 'Accessory Supplier', 'booked'),
        (6, 'WS0006', '2025-08-12', 'Screen Protection Co.', 'booked')
    `);

    // Add delivery lines for each product (1 quantity each)
    db.run(`INSERT INTO delivery_lines (delivery_id, product_version_id, quantity) VALUES 
        (1, 1, 1),  -- WS0001: iPhone 15 Pro 128GB
        (2, 2, 1),  -- WS0002: Samsung Galaxy S24 Ultra
        (3, 3, 1),  -- WS0003: AirPods Pro 2nd Gen
        (4, 4, 1),  -- WS0004: Samsung Galaxy Watch 6
        (5, 5, 1),  -- WS0005: Phone Case Clear
        (6, 6, 1)   -- WS0006: Screen Protector Premium
    `);

    console.log('New seed data created successfully!');
    console.log('');
    console.log('Product structure:');
    console.log('- Phones (IMEI tracking): iPhone 15 Pro, Samsung Galaxy S24 Ultra');
    console.log('- Electronics (Serial tracking): AirPods Pro, Galaxy Watch 6');
    console.log('- Accessories (No tracking): Phone Case, Screen Protector');
    console.log('- Each product has 1 unit in stock');
    console.log('');
    console.log('Deliveries created:');
    console.log('- WS0001: iPhone 15 Pro from Apple Inc.');
    console.log('- WS0002: Samsung Galaxy S24 Ultra from Samsung Electronics');
    console.log('- WS0003: AirPods Pro from Apple Inc.');
    console.log('- WS0004: Galaxy Watch 6 from Samsung Electronics');
    console.log('- WS0005: Phone Case from Accessory Supplier');
    console.log('- WS0006: Screen Protector from Screen Protection Co.');
});

db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
    console.log('Database reset and seeding completed!');
    process.exit(0);
});