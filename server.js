const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

// Database connection
const dbPath = path.join(__dirname, 'database.sqlite');
let db = new sqlite3.Database(dbPath);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// Product versions routes
app.get('/product-versions', (req, res) => {
    db.all(`
        SELECT pv.id, pv.name, pv.ean, pv.tracking_mode, pv.created_at, pv.updated_at,
               COALESCE(di_count.total_identifiers, 0) as total_identifiers,
               CASE 
                   WHEN pv.tracking_mode = 'none' THEN COALESCE(bs.quantity, 0)
                   ELSE COALESCE(di_count.stock_count, 0)
               END as stock_count
        FROM product_versions pv
        LEFT JOIN bulk_stock bs ON pv.id = bs.product_version_id
        LEFT JOIN (
            SELECT product_version_id, 
                   COUNT(*) as total_identifiers,
                   COUNT(CASE WHEN status = 'in_stock' AND (is_clearance IS NULL OR is_clearance = FALSE) THEN 1 END) as stock_count,
                   COUNT(CASE WHEN status = 'in_stock' AND is_clearance = TRUE THEN 1 END) as clearance_count
            FROM device_identifiers 
            GROUP BY product_version_id
        ) di_count ON pv.id = di_count.product_version_id
        ORDER BY pv.name
    `, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.render('product-versions', { productVersions: rows });
    });
});

app.get('/product-versions/new', (req, res) => {
    res.render('product-version-form', { productVersion: null });
});

app.post('/product-versions', (req, res) => {
    const { name, ean, tracking_mode } = req.body;
    
    db.run(`
        INSERT INTO product_versions (name, ean, tracking_mode, updated_at) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `, [name, ean, tracking_mode], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.redirect('/product-versions');
    });
});

app.get('/product-versions/:id/edit', (req, res) => {
    const productVersionId = req.params.id;
    
    db.get(`SELECT * FROM product_versions WHERE id = ?`, [productVersionId], (err, productVersion) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!productVersion) {
            return res.status(404).send('Product version not found');
        }
        
        res.render('product-version-form', { productVersion: productVersion });
    });
});

app.post('/product-versions/:id', (req, res) => {
    const productVersionId = req.params.id;
    const { name, ean, tracking_mode } = req.body;
    
    db.run(`
        UPDATE product_versions 
        SET name = ?, ean = ?, tracking_mode = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    `, [name, ean, tracking_mode, productVersionId], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.redirect(`/product-versions/${productVersionId}`);
    });
});

app.get('/product-versions/:id', (req, res) => {
    const productVersionId = req.params.id;
    
    // Get product version details
    db.get(`SELECT * FROM product_versions WHERE id = ?`, [productVersionId], (err, productVersion) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!productVersion) {
            return res.status(404).send('Product version not found');
        }
        
        // Get associated identifiers
        db.all(`
            SELECT * FROM device_identifiers 
            WHERE product_version_id = ? 
            ORDER BY created_at DESC
        `, [productVersionId], (err, identifiers) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Get bulk stock if tracking mode is 'none'
            if (productVersion.tracking_mode === 'none') {
                db.get(`SELECT * FROM bulk_stock WHERE product_version_id = ?`, [productVersionId], (err, bulkStock) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Get bulk stock history
                    db.all(`
                        SELECT * FROM bulk_stock_history 
                        WHERE product_version_id = ? 
                        ORDER BY created_at DESC 
                        LIMIT 10
                    `, [productVersionId], (err, stockHistory) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        res.render('product-version-detail', { 
                            productVersion: productVersion, 
                            identifiers: identifiers,
                            bulkStock: bulkStock || { quantity: 0 },
                            stockHistory: stockHistory || []
                        });
                    });
                });
            } else {
                res.render('product-version-detail', { 
                    productVersion: productVersion, 
                    identifiers: identifiers,
                    bulkStock: null,
                    stockHistory: []
                });
            }
        });
    });
});

// Identifiers routes
app.get('/identifiers', (req, res) => {
    const { search, product_version, status, clearance } = req.query;
    
    let query = `
        SELECT di.*, pv.name as product_version_name
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        WHERE 1=1
    `;
    let params = [];
    
    if (search) {
        query += ` AND (di.imei LIKE ? OR di.serial_number LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }
    
    if (product_version) {
        query += ` AND di.product_version_id = ?`;
        params.push(product_version);
    }
    
    if (status) {
        query += ` AND di.status = ?`;
        params.push(status);
    }
    
    if (clearance) {
        if (clearance === 'true') {
            query += ` AND di.is_clearance = TRUE`;
        } else if (clearance === 'false') {
            query += ` AND (di.is_clearance = FALSE OR di.is_clearance IS NULL)`;
        }
    }
    
    query += ` ORDER BY di.id DESC`;
    
    db.all(query, params, (err, identifiers) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        // Get product versions for filter dropdown
        db.all(`SELECT * FROM product_versions ORDER BY name`, (err, productVersions) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            res.render('identifiers', { 
                identifiers: identifiers,
                productVersions: productVersions,
                filters: { search, product_version, status, clearance }
            });
        });
    });
});

app.get('/identifiers/:id', (req, res) => {
    const identifierId = req.params.id;
    
    // Get identifier details
    db.get(`
        SELECT di.*, pv.name as product_version_name, pv.tracking_mode,
               d.delivery_number, d.supplier, d.delivery_date
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        LEFT JOIN deliveries d ON di.delivery_id = d.id
        WHERE di.id = ?
    `, [identifierId], (err, identifier) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!identifier) {
            return res.status(404).send('Identifier not found');
        }
        
        // Get status history
        db.all(`
            SELECT * FROM status_history 
            WHERE device_identifier_id = ? 
            ORDER BY created_at DESC
        `, [identifierId], (err, statusHistory) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Get product version swap history
            db.all(`
                SELECT pvh.*, 
                       old_pv.name as old_version_name,
                       new_pv.name as new_version_name
                FROM product_version_history pvh
                JOIN product_versions old_pv ON pvh.old_product_version_id = old_pv.id
                JOIN product_versions new_pv ON pvh.new_product_version_id = new_pv.id
                WHERE pvh.device_identifier_id = ? 
                ORDER BY pvh.created_at DESC
            `, [identifierId], (err, versionHistory) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: err.message });
                }
                
                // Get identifier swap history
                db.all(`
                    SELECT * FROM identifier_history 
                    WHERE device_identifier_id = ? 
                    ORDER BY created_at DESC
                `, [identifierId], (err, identifierHistory) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Get all available product versions for the version change modal
                    db.all(`SELECT * FROM product_versions ORDER BY name`, (err, productVersions) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        res.render('identifier-detail', { 
                            identifier: identifier,
                            statusHistory: statusHistory,
                            versionHistory: versionHistory,
                            identifierHistory: identifierHistory,
                            productVersions: productVersions,
                            error: req.query.error || null,
                            success: req.query.success || null
                        });
                    });
                });
            });
        });
    });
});

// Stock overview route
app.get('/stock', (req, res) => {
    db.all(`
        SELECT pv.id, pv.name, pv.ean, pv.tracking_mode, pv.created_at, pv.updated_at,
               CASE 
                   WHEN pv.tracking_mode = 'none' THEN COALESCE(bs.quantity, 0)
                   ELSE COALESCE(di_count.stock_count, 0)
               END as stock_count,
               COALESCE(bs.quantity, 0) as bulk_quantity
        FROM product_versions pv
        LEFT JOIN bulk_stock bs ON pv.id = bs.product_version_id
        LEFT JOIN (
            SELECT product_version_id, 
                   COUNT(CASE WHEN is_clearance IS NULL OR is_clearance = FALSE THEN 1 END) as stock_count,
                   COUNT(CASE WHEN is_clearance = TRUE THEN 1 END) as clearance_count
            FROM device_identifiers 
            WHERE status = 'in_stock'
            GROUP BY product_version_id
        ) di_count ON pv.id = di_count.product_version_id
        ORDER BY pv.name
    `, (err, stock) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.render('stock', { stock: stock });
    });
});

// Bulk stock adjustment route
app.post('/product-versions/:id/bulk-stock', (req, res) => {
    const productVersionId = req.params.id;
    const { quantity_change, note } = req.body;
    const quantityChange = parseInt(quantity_change);
    
    // Get current quantity
    db.get(`SELECT quantity FROM bulk_stock WHERE product_version_id = ?`, [productVersionId], (err, currentStock) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        const oldQuantity = currentStock ? currentStock.quantity : 0;
        const newQuantity = oldQuantity + quantityChange;
        
        if (newQuantity < 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        // Update bulk stock
        db.run(`
            INSERT INTO bulk_stock (product_version_id, quantity)
            VALUES (?, ?)
            ON CONFLICT(product_version_id) DO UPDATE SET
                quantity = ?,
                updated_at = CURRENT_TIMESTAMP
        `, [productVersionId, newQuantity, newQuantity], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Log the change
            db.run(`
                INSERT INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [productVersionId, oldQuantity, newQuantity, quantityChange, 'admin', note || 'Manual adjustment'], function(err) {
                if (err) {
                    console.error(err);
                }
                res.redirect(`/product-versions/${productVersionId}`);
            });
        });
    });
});

// Identifier change route
app.post('/identifiers/:id/change-identifier', (req, res) => {
    const identifierId = req.params.id;
    const { new_imei, new_serial_number, note } = req.body;
    
    // Get current identifier details and tracking mode
    db.get(`
        SELECT di.*, pv.tracking_mode 
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        WHERE di.id = ?
    `, [identifierId], (err, current) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!current) {
            return res.status(404).json({ error: 'Identifier not found' });
        }
        
        // Validation: Check if identifier status is 'in_stock'
        if (current.status !== 'in_stock') {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Identifiers kunnen alleen gewijzigd worden wanneer het product de status "Op voorraad" heeft')}`);
        }
        
        // Validation: Check if new values are different from current values
        const imeiChanged = new_imei && new_imei !== current.imei;
        const serialChanged = new_serial_number && new_serial_number !== current.serial_number;
        
        if (!imeiChanged && !serialChanged) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Nieuwe waarden moeten verschillen van de huidige waarden')}`);
        }
        
        // Validation: Check required fields based on tracking mode
        if (current.tracking_mode === 'imei' && !new_imei) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('IMEI is verplicht voor deze trackingconfiguratie')}`);
        }
        
        if (current.tracking_mode === 'serial' && !new_serial_number) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Serienummer is verplicht voor deze trackingconfiguratie')}`);
        }
        
        // Validation: Check if new values already exist in other identifiers
        const checkQuery = `
            SELECT COUNT(*) as count FROM device_identifiers 
            WHERE id != ? AND (
                (? IS NOT NULL AND imei = ?) OR 
                (? IS NOT NULL AND serial_number = ?)
            )
        `;
        
        db.get(checkQuery, [identifierId, new_imei, new_imei, new_serial_number, new_serial_number], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            if (result.count > 0) {
                return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Een van de nieuwe waarden bestaat al bij een andere identifier')}`);
            }
            
            // Update the identifier
            const updateQuery = `
                UPDATE device_identifiers 
                SET imei = COALESCE(?, imei), 
                    serial_number = COALESCE(?, serial_number),
                    updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `;
            
            db.run(updateQuery, [new_imei || null, new_serial_number || null, identifierId], function(err) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: err.message });
                }
                
                // Log the identifier change
                db.run(`
                    INSERT INTO identifier_history (
                        device_identifier_id, 
                        old_imei, 
                        new_imei, 
                        old_serial_number, 
                        new_serial_number, 
                        changed_by, 
                        note
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    identifierId, 
                    current.imei, 
                    new_imei || current.imei, 
                    current.serial_number, 
                    new_serial_number || current.serial_number,
                    'admin', 
                    note || 'Identifier gewijzigd'
                ], (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    res.redirect(`/identifiers/${identifierId}?success=${encodeURIComponent('Identifier succesvol gewijzigd')}`);
                });
            });
        });
    });
});

// Product version change route
app.post('/identifiers/:id/change-product-version', (req, res) => {
    const identifierId = req.params.id;
    const { new_product_version_id, note } = req.body;
    
    // Get current identifier details
    db.get(`
        SELECT di.*, pv.name as current_product_version_name
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        WHERE di.id = ?
    `, [identifierId], (err, current) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!current) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Identifier not found')}`);
        }
        
        // Validation: Check if identifier status is 'in_stock'
        if (current.status !== 'in_stock') {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Productversie kan alleen gewijzigd worden wanneer het product de status "Op voorraad" heeft')}`);
        }
        
        // Validation: Check if new product version is different from current
        if (parseInt(new_product_version_id) === current.product_version_id) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Nieuwe productversie moet verschillen van de huidige productversie')}`);
        }
        
        // Validation: Check if new product version exists and is active
        db.get(`SELECT * FROM product_versions WHERE id = ?`, [new_product_version_id], (err, newProductVersion) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            if (!newProductVersion) {
                return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Geselecteerde productversie bestaat niet')}`);
            }
            
            // Get current product version details for tracking mode comparison
            db.get(`SELECT tracking_mode FROM product_versions WHERE id = ?`, [current.product_version_id], (err, currentProductVersion) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: err.message });
                }
                
                // Validation: Check if tracking modes match
                if (newProductVersion.tracking_mode !== currentProductVersion.tracking_mode) {
                    return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Nieuwe productversie moet dezelfde trackingconfiguratie hebben als de huidige productversie')}`);
                }
                
                // Update the identifier's product version
                db.run(`
                    UPDATE device_identifiers 
                    SET product_version_id = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [new_product_version_id, identifierId], function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Log the product version change in history
                    db.run(`
                        INSERT INTO product_version_history (
                            device_identifier_id, 
                            old_product_version_id, 
                            new_product_version_id, 
                            changed_by, 
                            note
                        ) VALUES (?, ?, ?, ?, ?)
                    `, [
                        identifierId, 
                        current.product_version_id, 
                        new_product_version_id,
                        'admin', 
                        note || 'Productversie gewijzigd'
                    ], (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: err.message });
                        }
                        
                        res.redirect(`/identifiers/${identifierId}?success=${encodeURIComponent('Productversie succesvol gewijzigd')}`);
                    });
                });
            });
        });
    });
});

// Status change route
app.post('/identifiers/:id/status', (req, res) => {
    const identifierId = req.params.id;
    const { new_status, note } = req.body;
    
    // Get current status first
    db.get(`SELECT status FROM device_identifiers WHERE id = ?`, [identifierId], (err, current) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        // Update status
        db.run(`
            UPDATE device_identifiers 
            SET status = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [new_status, identifierId], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Log status change
            db.run(`
                INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note)
                VALUES (?, ?, ?, ?, ?)
            `, [identifierId, current.status, new_status, 'admin', note], (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: err.message });
                }
                
                res.redirect(`/identifiers/${identifierId}`);
            });
        });
    });
});

// Clearance management routes
app.post('/identifiers/:id/toggle-clearance', (req, res) => {
    const identifierId = req.params.id;
    const { clearance_price, clearance_reason, remove_clearance } = req.body;
    
    // Get current identifier details
    db.get(`SELECT status, is_clearance FROM device_identifiers WHERE id = ?`, [identifierId], (err, current) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!current) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Identifier niet gevonden')}`);
        }
        
        // Validation: Only allow clearance marking for 'in_stock' items
        if (current.status !== 'in_stock') {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Alleen items met status "Op voorraad" kunnen als koopje gemarkeerd worden')}`);
        }
        
        // Determine new clearance status
        const newClearanceStatus = remove_clearance ? false : !current.is_clearance;
        
        // Validation: If setting clearance, validate price
        if (newClearanceStatus && clearance_price && parseFloat(clearance_price) <= 0) {
            return res.redirect(`/identifiers/${identifierId}?error=${encodeURIComponent('Koopjesprijs moet positief zijn')}`);
        }
        
        // Update clearance status
        const updateQuery = newClearanceStatus ? 
            `UPDATE device_identifiers 
             SET is_clearance = TRUE, 
                 clearance_price = ?, 
                 clearance_reason = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?` :
            `UPDATE device_identifiers 
             SET is_clearance = FALSE, 
                 clearance_price = NULL, 
                 clearance_reason = NULL,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`;
        
        const params = newClearanceStatus ? 
            [clearance_price || null, clearance_reason || null, identifierId] :
            [identifierId];
        
        db.run(updateQuery, params, function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            const action = newClearanceStatus ? 'gemarkeerd als koopje' : 'koopje status verwijderd';
            const successMessage = `Identifier succesvol ${action}`;
            
            res.redirect(`/identifiers/${identifierId}?success=${encodeURIComponent(successMessage)}`);
        });
    });
});

// Clearance overview route
app.get('/clearance', (req, res) => {
    const { product_version, sort_by = 'created_at', sort_order = 'DESC' } = req.query;
    
    let query = `
        SELECT di.*, pv.name as product_version_name
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        WHERE di.is_clearance = TRUE AND di.status = 'in_stock'
    `;
    let params = [];
    
    if (product_version) {
        query += ` AND di.product_version_id = ?`;
        params.push(product_version);
    }
    
    // Add sorting
    const validSortColumns = ['created_at', 'clearance_price', 'product_version_name'];
    const validSortOrders = ['ASC', 'DESC'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';
    
    if (sortColumn === 'product_version_name') {
        query += ` ORDER BY pv.name ${sortOrder}`;
    } else {
        query += ` ORDER BY di.${sortColumn} ${sortOrder}`;
    }
    
    db.all(query, params, (err, clearanceItems) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        // Get product versions for filter dropdown
        db.all(`SELECT * FROM product_versions ORDER BY name`, (err, productVersions) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            res.render('clearance', { 
                clearanceItems: clearanceItems,
                productVersions: productVersions,
                filters: { product_version, sort_by, sort_order }
            });
        });
    });
});

// Deliveries routes
app.get('/deliveries', (req, res) => {
    db.all(`
        SELECT d.*, 
               COUNT(dl.id) as line_count,
               SUM(dl.quantity) as total_quantity
        FROM deliveries d
        LEFT JOIN delivery_lines dl ON d.id = dl.delivery_id
        GROUP BY d.id
        ORDER BY d.delivery_date DESC, d.created_at DESC
    `, (err, deliveries) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.render('deliveries', { deliveries: deliveries });
    });
});

app.get('/deliveries/new', (req, res) => {
    res.render('delivery-form', { delivery: null });
});

app.post('/deliveries', (req, res) => {
    const { delivery_date, supplier } = req.body;
    
    // Generate next delivery number in WS format
    db.get(`SELECT delivery_number FROM deliveries ORDER BY id DESC LIMIT 1`, (err, lastDelivery) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        let nextNumber = 1;
        if (lastDelivery && lastDelivery.delivery_number) {
            // Extract number from WS0001 format
            const match = lastDelivery.delivery_number.match(/WS(\d+)/);
            if (match) {
                nextNumber = parseInt(match[1]) + 1;
            }
        }
        
        // Format as WS0001, WS0002, etc.
        const delivery_number = `WS${nextNumber.toString().padStart(4, '0')}`;
        
        db.run(`
            INSERT INTO deliveries (delivery_number, delivery_date, supplier, updated_at) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [delivery_number, delivery_date, supplier], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            res.redirect(`/deliveries/${this.lastID}`);
        });
    });
});

app.get('/deliveries/:id', (req, res) => {
    const deliveryId = req.params.id;
    
    // Get delivery details
    db.get(`SELECT * FROM deliveries WHERE id = ?`, [deliveryId], (err, delivery) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!delivery) {
            return res.status(404).send('Delivery not found');
        }
        
        // Get delivery lines with product version info
        db.all(`
            SELECT dl.*, pv.name as product_version_name, pv.tracking_mode
            FROM delivery_lines dl
            JOIN product_versions pv ON dl.product_version_id = pv.id
            WHERE dl.delivery_id = ?
            ORDER BY dl.created_at
        `, [deliveryId], (err, lines) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Get identifiers for each line that was registered with this delivery
            const linePromises = lines.map(line => {
                return new Promise((resolve, reject) => {
                    if (line.tracking_mode === 'none') {
                        line.identifiers = [];
                        resolve(line);
                    } else {
                        db.all(`
                            SELECT di.id, di.imei, di.serial_number, di.original_imei, di.original_serial_number, 
                                   di.status, di.purchase_price, di.created_at, d.delivery_number,
                                   current_pv.name as current_product_version_name,
                                   original_pv.name as original_product_version_name,
                                   CASE 
                                       WHEN (di.imei != di.original_imei AND di.original_imei IS NOT NULL) 
                                         OR (di.serial_number != di.original_serial_number AND di.original_serial_number IS NOT NULL)
                                       THEN 1 
                                       ELSE 0 
                                   END as is_identifier_swapped,
                                   CASE 
                                       WHEN di.product_version_id != di.original_product_version_id
                                       THEN 1 
                                       ELSE 0 
                                   END as is_product_version_swapped
                            FROM device_identifiers di
                            LEFT JOIN deliveries d ON di.delivery_id = d.id
                            LEFT JOIN product_versions current_pv ON di.product_version_id = current_pv.id
                            LEFT JOIN product_versions original_pv ON di.original_product_version_id = original_pv.id
                            WHERE di.delivery_id = ? 
                            AND di.original_product_version_id = ?
                            ORDER BY di.created_at
                        `, [deliveryId, line.product_version_id], (err, identifiers) => {
                            if (err) {
                                reject(err);
                            } else {
                                line.identifiers = identifiers || [];
                                resolve(line);
                            }
                        });
                    }
                });
            });

            Promise.all(linePromises).then(linesWithIdentifiers => {
                // Get all product versions for adding new lines
                db.all(`SELECT * FROM product_versions ORDER BY name`, (err, productVersions) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    res.render('delivery-detail', { 
                        delivery: delivery, 
                        lines: linesWithIdentifiers,
                        productVersions: productVersions
                    });
                });
            }).catch(err => {
                console.error(err);
                return res.status(500).json({ error: err.message });
            });
        });
    });
});

app.post('/deliveries/:id/lines', (req, res) => {
    const deliveryId = req.params.id;
    const { product_version_id, quantity, purchase_price_per_unit, identifiers } = req.body;
    
    // First check the tracking mode of the product version
    db.get(`SELECT tracking_mode FROM product_versions WHERE id = ?`, [product_version_id], (err, productVersion) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        // Validate purchase price
        if (!purchase_price_per_unit || parseFloat(purchase_price_per_unit) <= 0) {
            return res.status(400).json({ error: 'Purchase price per unit is required and must be positive' });
        }

        // Add the delivery line
        db.run(`
            INSERT INTO delivery_lines (delivery_id, product_version_id, quantity, purchase_price_per_unit)
            VALUES (?, ?, ?, ?)
        `, [deliveryId, product_version_id, quantity, parseFloat(purchase_price_per_unit)], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            // Handle based on tracking mode
            if (productVersion.tracking_mode === 'none') {
                // For non-tracked items, update bulk stock
                db.run(`
                    INSERT INTO bulk_stock (product_version_id, quantity)
                    VALUES (?, ?)
                    ON CONFLICT(product_version_id) DO UPDATE SET
                        quantity = quantity + EXCLUDED.quantity,
                        updated_at = CURRENT_TIMESTAMP
                `, [product_version_id, quantity], function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Log the bulk stock change
                    db.run(`
                        INSERT INTO bulk_stock_history (product_version_id, old_quantity, new_quantity, change_quantity, changed_by, note)
                        SELECT ?, 
                               COALESCE((SELECT quantity FROM bulk_stock WHERE product_version_id = ?) - ?, 0) as old_quantity,
                               (SELECT quantity FROM bulk_stock WHERE product_version_id = ?) as new_quantity,
                               ? as change_quantity,
                               'system' as changed_by,
                               'Delivery booking' as note
                    `, [product_version_id, product_version_id, quantity, product_version_id, quantity], function(err) {
                        if (err) {
                            console.error(err);
                        }
                        res.redirect(`/deliveries/${deliveryId}`);
                    });
                });
            } else {
                // For tracked items, add individual identifiers
                if (identifiers && Array.isArray(identifiers) && identifiers.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO device_identifiers (product_version_id, original_product_version_id, delivery_id, imei, serial_number, original_imei, original_serial_number, status, purchase_price)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'in_stock', ?)
                    `);
                    
                    identifiers.forEach(identifier => {
                        if (identifier && (identifier.imei || identifier.serial_number)) {
                            const imei = identifier.imei || null;
                            const serialNumber = identifier.serial_number || null;
                            stmt.run([product_version_id, product_version_id, deliveryId, imei, serialNumber, imei, serialNumber, parseFloat(purchase_price_per_unit)]);
                        }
                    });
                    
                    stmt.finalize();
                }
                
                res.redirect(`/deliveries/${deliveryId}`);
            }
        });
    });
});

// Book delivery route
app.post('/deliveries/:id/book', (req, res) => {
    const deliveryId = req.params.id;
    
    // Update delivery status to booked
    db.run(`
        UPDATE deliveries 
        SET status = 'booked', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    `, [deliveryId], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        // Log status history for all identifiers created from this delivery
        db.run(`
            INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note)
            SELECT di.id, NULL, 'in_stock', 'system', 'Ingeboekt via levering'
            FROM device_identifiers di
            JOIN delivery_lines dl ON di.product_version_id = dl.product_version_id
            WHERE dl.delivery_id = ? AND di.created_at >= (
                SELECT created_at FROM deliveries WHERE id = ?
            )
        `, [deliveryId, deliveryId], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: err.message });
            }
            
            res.redirect(`/deliveries/${deliveryId}`);
        });
    });
});

// Admin routes
app.post('/admin/reset-database', (req, res) => {
    const { exec } = require('child_process');
    
    console.log('Admin database reset requested...');
    
    // Close the current database connection to release the lock
    db.close((closeErr) => {
        if (closeErr) {
            console.error('Error closing database for reset:', closeErr);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to close database connection: ' + closeErr.message 
            });
        }
        
        console.log('Database connection closed for reset');
        
        // Execute the reset script
        exec('npm run reset-db', { cwd: __dirname }, (error, stdout, stderr) => {
            // Reconnect to the database regardless of reset success/failure
            const reconnectDb = () => {
                db = new sqlite3.Database(dbPath, (reconnectErr) => {
                    if (reconnectErr) {
                        console.error('Failed to reconnect to database:', reconnectErr);
                    } else {
                        console.log('Database reconnected successfully');
                    }
                });
            };
            
            if (error) {
                console.error('Database reset failed:', error);
                reconnectDb();
                return res.status(500).json({ 
                    success: false, 
                    error: 'Database reset failed: ' + error.message 
                });
            }
            
            if (stderr) {
                console.warn('Database reset warnings:', stderr);
            }
            
            console.log('Database reset completed successfully');
            console.log(stdout);
            
            // Reconnect to the fresh database
            reconnectDb();
            
            res.json({ 
                success: true, 
                message: 'Database has been successfully reset to initial mobile retail data.' 
            });
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});