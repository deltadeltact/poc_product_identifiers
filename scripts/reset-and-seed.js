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

    // Add deliveries with specific timestamps
    db.run(`INSERT INTO deliveries (id, delivery_number, delivery_date, supplier, status, created_at, updated_at) VALUES 
        (1, 'WS0001', '2025-08-10', 'Apple Inc.', 'booked', '2025-08-10 09:00:00', '2025-08-10 09:00:00'),
        (2, 'WS0002', '2025-08-11', 'Samsung Electronics', 'booked', '2025-08-11 10:30:00', '2025-08-11 10:30:00'),
        (3, 'WS0003', '2025-08-11', 'Apple Inc.', 'booked', '2025-08-11 14:15:00', '2025-08-11 14:15:00'),
        (4, 'WS0004', '2025-08-12', 'Samsung Electronics', 'booked', '2025-08-12 08:45:00', '2025-08-12 08:45:00'),
        (5, 'WS0005', '2025-08-12', 'Accessory Supplier', 'booked', '2025-08-12 11:20:00', '2025-08-12 11:20:00'),
        (6, 'WS0006', '2025-08-12', 'Screen Protection Co.', 'booked', '2025-08-12 13:10:00', '2025-08-12 13:10:00')
    `);

    // Add delivery lines with more realistic quantities
    db.run(`INSERT INTO delivery_lines (delivery_id, product_version_id, quantity, created_at) VALUES 
        (1, 1, 3, '2025-08-10 09:05:00'),  -- WS0001: 3x iPhone 15 Pro 128GB
        (2, 2, 2, '2025-08-11 10:35:00'),  -- WS0002: 2x Samsung Galaxy S24 Ultra
        (3, 3, 4, '2025-08-11 14:20:00'),  -- WS0003: 4x AirPods Pro 2nd Gen
        (4, 4, 2, '2025-08-12 08:50:00'),  -- WS0004: 2x Samsung Galaxy Watch 6
        (5, 5, 10, '2025-08-12 11:25:00'), -- WS0005: 10x Phone Case Clear
        (6, 6, 15, '2025-08-12 13:15:00')  -- WS0006: 15x Screen Protector Premium
    `);

    // Add individual identifiers for tracked products with delivery_id references
    db.run(`INSERT INTO device_identifiers (product_version_id, delivery_id, imei, serial_number, original_imei, original_serial_number, status, created_at, updated_at) VALUES 
        -- iPhone 15 Pro (IMEI tracking) - Delivery WS0001 (delivery_id = 1)
        (1, 1, '351234567890001', NULL, '351234567890001', NULL, 'in_stock', '2025-08-10 09:10:00', '2025-08-10 09:10:00'),
        (1, 1, '351234567890002', NULL, '351234567890002', NULL, 'in_stock', '2025-08-10 09:11:00', '2025-08-10 09:11:00'),
        (1, 1, '351234567890003', NULL, '351234567890003', NULL, 'sold', '2025-08-10 09:12:00', '2025-08-11 15:30:00'),
        
        -- Samsung Galaxy S24 Ultra (IMEI tracking) - Delivery WS0002 (delivery_id = 2)
        (2, 2, '351876543210001', NULL, '351876543210001', NULL, 'in_stock', '2025-08-11 10:40:00', '2025-08-11 10:40:00'),
        (2, 2, '351876543210002', NULL, '351876543210002', NULL, 'in_stock', '2025-08-11 10:41:00', '2025-08-11 10:41:00'),
        
        -- AirPods Pro (Serial tracking) - Delivery WS0003 (delivery_id = 3)
        (3, 3, NULL, 'AP2024001', NULL, 'AP2024001', 'in_stock', '2025-08-11 14:25:00', '2025-08-11 14:25:00'),
        (3, 3, NULL, 'AP2024002', NULL, 'AP2024002', 'in_stock', '2025-08-11 14:26:00', '2025-08-11 14:26:00'),
        (3, 3, NULL, 'AP2024003', NULL, 'AP2024003', 'sold', '2025-08-11 14:27:00', '2025-08-12 10:15:00'),
        (3, 3, NULL, 'AP2024004', NULL, 'AP2024004', 'in_stock', '2025-08-11 14:28:00', '2025-08-11 14:28:00'),
        
        -- Galaxy Watch (Serial tracking) - Delivery WS0004 (delivery_id = 4)
        (4, 4, NULL, 'GW2024001', NULL, 'GW2024001', 'in_stock', '2025-08-12 08:55:00', '2025-08-12 08:55:00'),
        (4, 4, NULL, 'GW2024002', NULL, 'GW2024002', 'in_stock', '2025-08-12 08:56:00', '2025-08-12 08:56:00')
    `);

    // Add bulk stock for non-tracked products (accessories)
    db.run(`INSERT INTO bulk_stock (product_version_id, quantity, created_at, updated_at) VALUES 
        (5, 10, '2025-08-12 11:30:00', '2025-08-12 11:30:00'),  -- Phone Case Clear: 10 pieces
        (6, 15, '2025-08-12 13:20:00', '2025-08-12 13:20:00')   -- Screen Protector Premium: 15 pieces  
    `);

    // Add initial status history for tracked identifiers
    db.run(`INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note, created_at) VALUES 
        (1, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001', '2025-08-10 09:10:00'),
        (2, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001', '2025-08-10 09:11:00'),
        (3, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001', '2025-08-10 09:12:00'),
        (3, 'in_stock', 'sold', 'admin', 'Verkocht aan klant', '2025-08-11 15:30:00'),
        (4, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002', '2025-08-11 10:40:00'),
        (5, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0002', '2025-08-11 10:41:00'),
        (6, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0003', '2025-08-11 14:25:00'),
        (7, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0003', '2025-08-11 14:26:00'),
        (8, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0003', '2025-08-11 14:27:00'),
        (8, 'in_stock', 'sold', 'admin', 'Verkocht aan klant', '2025-08-12 10:15:00'),
        (9, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0003', '2025-08-11 14:28:00'),
        (10, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0004', '2025-08-12 08:55:00'),
        (11, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0004', '2025-08-12 08:56:00')
    `);

    // Add initial bulk stock history for non-tracked products
    db.run(`INSERT INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note, created_at) VALUES 
        (5, 0, 10, 10, 'system', 'Ingeboekt via levering WS0005', '2025-08-12 11:30:00'),
        (6, 0, 15, 15, 'system', 'Ingeboekt via levering WS0006', '2025-08-12 13:20:00')
    `);

    console.log('New seed data created successfully!');
    console.log('');
    console.log('Product structure:');
    console.log('- Phones (IMEI tracking): iPhone 15 Pro, Samsung Galaxy S24 Ultra');
    console.log('- Electronics (Serial tracking): AirPods Pro, Galaxy Watch 6');
    console.log('- Accessories (No tracking): Phone Case, Screen Protector');
    console.log('');
    console.log('Deliveries created with identifiers:');
    console.log('- WS0001 (2025-08-10): 3x iPhone 15 Pro from Apple Inc.');
    console.log('  └─ IMEI: 351234567890001, 351234567890002, 351234567890003 (sold)');
    console.log('- WS0002 (2025-08-11): 2x Samsung Galaxy S24 Ultra from Samsung Electronics');
    console.log('  └─ IMEI: 351876543210001, 351876543210002');
    console.log('- WS0003 (2025-08-11): 4x AirPods Pro from Apple Inc.');
    console.log('  └─ Serial: AP2024001, AP2024002, AP2024003 (sold), AP2024004');
    console.log('- WS0004 (2025-08-12): 2x Galaxy Watch 6 from Samsung Electronics');
    console.log('  └─ Serial: GW2024001, GW2024002');
    console.log('- WS0005 (2025-08-12): 10x Phone Case from Accessory Supplier (bulk stock)');
    console.log('- WS0006 (2025-08-12): 15x Screen Protector from Screen Protection Co. (bulk stock)');
    console.log('');
    console.log('Stock status:');
    console.log('- 2x iPhone 15 Pro in stock, 1x sold');
    console.log('- 2x Samsung Galaxy S24 Ultra in stock');
    console.log('- 3x AirPods Pro in stock, 1x sold');
    console.log('- 2x Galaxy Watch 6 in stock');
    console.log('- 10x Phone Case in bulk stock');
    console.log('- 15x Screen Protector in bulk stock');
});

db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
    console.log('Database reset and seeding completed!');
    process.exit(0);
});