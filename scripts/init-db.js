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
                CHECK (tracking_mode IN ('none', 'imei', 'serial', 'both')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Device identifiers table
    db.run(`
        CREATE TABLE IF NOT EXISTS device_identifiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_version_id INTEGER NOT NULL,
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_version_id) REFERENCES product_versions (id),
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
    
    // Sample product versions
    db.run(`INSERT OR IGNORE INTO product_versions (id, name, ean, tracking_mode) VALUES 
        (1, 'iPhone 14 Pro 128GB', '1234567890123', 'both'),
        (2, 'Samsung Galaxy S23', '1234567890124', 'imei'),
        (3, 'MacBook Pro 13"', '1234567890125', 'serial'),
        (4, 'AirPods Pro', '1234567890126', 'none')
    `);

    // Sample device identifiers
    db.run(`INSERT OR IGNORE INTO device_identifiers (product_version_id, imei, serial_number, status) VALUES 
        (1, '351234567890123', 'F2LLD1234567', 'in_stock'),
        (1, '351234567890124', 'F2LLD1234568', 'in_stock'),
        (2, '351234567890125', NULL, 'in_stock'),
        (2, '351234567890126', NULL, 'sold'),
        (3, NULL, 'C02Y1234ABCD', 'in_stock')
    `);

    // Sample status history
    db.run(`INSERT OR IGNORE INTO status_history (device_identifier_id, old_status, new_status, changed_by) VALUES 
        (1, NULL, 'in_stock', 'system'),
        (2, NULL, 'in_stock', 'system'),
        (3, NULL, 'in_stock', 'system'),
        (4, 'in_stock', 'sold', 'admin'),
        (5, NULL, 'in_stock', 'system')
    `);

    // Sample bulk stock for non-tracked products (AirPods Pro)
    db.run(`INSERT OR IGNORE INTO bulk_stock (product_version_id, quantity) VALUES 
        (4, 50)
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