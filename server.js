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
        
        // Get associated identifiers (including clearance information)
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
                    
                    // Get clearance history
                    db.all(`
                        SELECT * FROM clearance_history 
                        WHERE device_identifier_id = ? 
                        ORDER BY created_at DESC
                    `, [identifierId], (err, clearanceHistory) => {
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
                                clearanceHistory: clearanceHistory,
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
    
    // Get current identifier details including clearance info
    db.get(`SELECT status, is_clearance, clearance_price, clearance_reason FROM device_identifiers WHERE id = ?`, [identifierId], (err, current) => {
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
            
            // Log clearance change to history
            const newPrice = newClearanceStatus ? (clearance_price ? parseFloat(clearance_price) : null) : null;
            const newReason = newClearanceStatus ? (clearance_reason || null) : null;
            
            db.run(`
                INSERT INTO clearance_history (
                    device_identifier_id, 
                    old_is_clearance, 
                    new_is_clearance,
                    old_clearance_price,
                    new_clearance_price,
                    old_clearance_reason,
                    new_clearance_reason,
                    changed_by, 
                    note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                identifierId,
                current.is_clearance || false,
                newClearanceStatus,
                current.clearance_price,
                newPrice,
                current.clearance_reason,
                newReason,
                'admin',
                newClearanceStatus ? 'Gemarkeerd als koopje' : 'Koopje status verwijderd'
            ], (historyErr) => {
                if (historyErr) {
                    console.error('Failed to log clearance history:', historyErr);
                }
                
                const action = newClearanceStatus ? 'gemarkeerd als koopje' : 'koopje status verwijderd';
                const successMessage = `Identifier succesvol ${action}`;
                
                res.redirect(`/identifiers/${identifierId}?success=${encodeURIComponent(successMessage)}`);
            });
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
    
    // Check if delivery has tracked items that need damage assessment
    db.get(`
        SELECT COUNT(*) as tracked_count
        FROM delivery_lines dl
        JOIN product_versions pv ON dl.product_version_id = pv.id
        WHERE dl.delivery_id = ? AND pv.tracking_mode != 'none'
    `, [deliveryId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.tracked_count > 0) {
            // Has tracked items, redirect to damage assessment
            res.redirect(`/deliveries/${deliveryId}/assess-damage`);
        } else {
            // No tracked items, complete booking immediately
            db.run(`
                UPDATE deliveries 
                SET status = 'booked', updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [deliveryId], function(err) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: err.message });
                }
                res.redirect(`/deliveries/${deliveryId}`);
            });
        }
    });
});

// Damage assessment routes
app.get('/deliveries/:id/assess-damage', (req, res) => {
    const deliveryId = req.params.id;
    
    // Get delivery details
    db.get(`
        SELECT d.*, 
               COUNT(DISTINCT dl.id) as line_count,
               SUM(dl.quantity * dl.purchase_price_per_unit) as total_value
        FROM deliveries d
        LEFT JOIN delivery_lines dl ON d.id = dl.delivery_id
        WHERE d.id = ?
        GROUP BY d.id
    `, [deliveryId], (err, delivery) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        
        if (!delivery) {
            return res.status(404).send('Delivery not found');
        }
        
        // Get all identifiers for this delivery that need damage assessment
        db.all(`
            SELECT di.*, pv.name as product_name, pv.tracking_mode,
                   d.delivery_number
            FROM device_identifiers di
            JOIN product_versions pv ON di.product_version_id = pv.id
            JOIN deliveries d ON di.delivery_id = d.id
            WHERE di.delivery_id = ?
            ORDER BY pv.name, di.id
        `, [deliveryId], (err, identifiers) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            
            res.render('damage-assessment', {
                delivery,
                identifiers
            });
        });
    });
});

app.post('/deliveries/:id/assess-damage', (req, res) => {
    const deliveryId = req.params.id;
    const { damage_assessment } = req.body;
    
    // Process damage assessment for each identifier
    const stmt = db.prepare(`
        UPDATE device_identifiers 
        SET status = ?, received_damaged = ?, damage_description = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);
    
    const statusHistoryStmt = db.prepare(`
        INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note)
        VALUES (?, NULL, ?, 'system', ?)
    `);
    
    if (damage_assessment) {
        Object.keys(damage_assessment).forEach(identifierId => {
            const assessment = damage_assessment[identifierId];
            const isDamaged = assessment.is_damaged === 'true';
            const status = isDamaged ? 'defective_at_delivery' : 'in_stock';
            const damageDescription = isDamaged ? assessment.damage_description : null;
            
            stmt.run([status, isDamaged, damageDescription, identifierId]);
            
            const historyNote = isDamaged 
                ? `Defect geconstateerd bij levering - ${damageDescription}`
                : 'Ingeboekt via levering';
            statusHistoryStmt.run([identifierId, status, historyNote]);
        });
    }
    
    stmt.finalize();
    statusHistoryStmt.finalize();
    
    // Complete the delivery booking
    db.run(`
        UPDATE deliveries 
        SET status = 'booked', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    `, [deliveryId], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: err.message });
        }
        
        res.redirect(`/deliveries/${deliveryId}`);
    });
});

// Damage review routes
app.get('/damage-review', (req, res) => {
    // Get all items marked as defective_at_delivery
    db.all(`
        SELECT di.*, pv.name as product_name, pv.tracking_mode,
               d.delivery_number, d.supplier, d.delivery_date
        FROM device_identifiers di
        JOIN product_versions pv ON di.product_version_id = pv.id
        JOIN deliveries d ON di.delivery_id = d.id
        WHERE di.status = 'defective_at_delivery'
        ORDER BY di.created_at DESC
    `, (err, damagedItems) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        
        res.render('damage-review', {
            damagedItems
        });
    });
});

app.post('/damage-review/action', (req, res) => {
    const { action, identifier_ids, clearance_price, clearance_reason } = req.body;
    
    if (!action || !identifier_ids || (Array.isArray(identifier_ids) && identifier_ids.length === 0)) {
        return res.status(400).json({ error: 'Action and identifier IDs are required' });
    }
    
    const identifierList = Array.isArray(identifier_ids) ? identifier_ids : [identifier_ids];
    
    let newStatus;
    let statusNote;
    
    switch (action) {
        case 'return_to_supplier':
            newStatus = 'returned_to_supplier';
            statusNote = 'Geretourneerd naar leverancier wegens defect bij levering';
            break;
        case 'mark_as_clearance':
            newStatus = 'in_stock';
            statusNote = `Naar koopjeskelder - ${clearance_reason || 'Schade bij levering'}`;
            break;
        case 'write_off':
            newStatus = 'written_off';
            statusNote = 'Afgeboekt wegens te grote schade bij levering';
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Update identifiers
    const updateStmt = db.prepare(`
        UPDATE device_identifiers 
        SET status = ?, is_clearance = ?, clearance_price = ?, clearance_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);
    
    const statusHistoryStmt = db.prepare(`
        INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note)
        VALUES (?, 'defective_at_delivery', ?, 'admin', ?)
    `);
    
    const clearanceHistoryStmt = db.prepare(`
        INSERT INTO clearance_history (device_identifier_id, old_is_clearance, new_is_clearance, old_clearance_price, new_clearance_price, old_clearance_reason, new_clearance_reason, changed_by, note)
        VALUES (?, FALSE, TRUE, NULL, ?, NULL, ?, 'admin', 'Moved to clearance from damage review')
    `);
    
    identifierList.forEach(id => {
        if (action === 'mark_as_clearance') {
            updateStmt.run([newStatus, true, parseFloat(clearance_price) || null, clearance_reason, id]);
            clearanceHistoryStmt.run([id, parseFloat(clearance_price) || null, clearance_reason]);
        } else {
            updateStmt.run([newStatus, false, null, null, id]);
        }
        statusHistoryStmt.run([id, newStatus, statusNote]);
    });
    
    updateStmt.finalize();
    statusHistoryStmt.finalize();
    clearanceHistoryStmt.finalize();
    
    res.json({ success: true, message: `${identifierList.length} item(s) processed successfully` });
});

// Admin routes
// Database reset function
function resetDatabaseToDefaults(callback) {
    const fs = require('fs');
    
    // Create new database (will overwrite existing)
    const resetDb = new sqlite3.Database(dbPath);
    
    console.log('Creating fresh database with initial schema and data...');
    
    resetDb.serialize(() => {
        // Drop all tables first
        console.log('Dropping existing tables...');
        resetDb.run(`DROP TABLE IF EXISTS clearance_history`);
        resetDb.run(`DROP TABLE IF EXISTS bulk_stock_history`);
        resetDb.run(`DROP TABLE IF EXISTS bulk_stock`);
        resetDb.run(`DROP TABLE IF EXISTS delivery_lines`);
        resetDb.run(`DROP TABLE IF EXISTS deliveries`);
        resetDb.run(`DROP TABLE IF EXISTS identifier_history`);
        resetDb.run(`DROP TABLE IF EXISTS product_version_history`);
        resetDb.run(`DROP TABLE IF EXISTS status_history`);
        resetDb.run(`DROP TABLE IF EXISTS device_identifiers`);
        resetDb.run(`DROP TABLE IF EXISTS product_versions`);

        // Create complete database schema
        resetDb.exec(`
            -- Product versions table
            CREATE TABLE IF NOT EXISTS product_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                ean TEXT,
                tracking_mode TEXT NOT NULL DEFAULT 'none' 
                    CHECK (tracking_mode IN ('none', 'imei', 'serial')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Device identifiers table
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
                received_damaged BOOLEAN DEFAULT FALSE,
                damage_description TEXT,
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
            );

            -- Deliveries table
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delivery_number TEXT NOT NULL UNIQUE,
                delivery_date DATE NOT NULL,
                supplier TEXT,
                status TEXT NOT NULL DEFAULT 'concept' 
                    CHECK (status IN ('concept', 'booked', 'partially_booked')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Delivery lines table
            CREATE TABLE IF NOT EXISTS delivery_lines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delivery_id INTEGER NOT NULL,
                product_version_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                purchase_price_per_unit DECIMAL(10,2) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (delivery_id) REFERENCES deliveries (id),
                FOREIGN KEY (product_version_id) REFERENCES product_versions (id)
            );

            -- Status history table
            CREATE TABLE IF NOT EXISTS status_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_identifier_id INTEGER NOT NULL,
                old_status TEXT,
                new_status TEXT NOT NULL,
                changed_by TEXT NOT NULL DEFAULT 'system',
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (device_identifier_id) REFERENCES device_identifiers (id)
            );

            -- Bulk stock table for non-tracked products
            CREATE TABLE IF NOT EXISTS bulk_stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_version_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_version_id) REFERENCES product_versions (id),
                UNIQUE(product_version_id)
            );

            -- History tables
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
            );

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
            );

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
            );

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
            );
        `, (error) => {
            if (error) {
                console.error('Schema creation failed:', error);
                resetDb.close();
                return callback(error);
            }
            
            console.log('Database schema created successfully!');
            
            // Add comprehensive mobile retail product catalog
            resetDb.run(`
                INSERT INTO product_versions (id, name, ean, tracking_mode) VALUES
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
            `, (insertError) => {
                if (insertError) {
                    console.error('Product versions insertion failed:', insertError);
                    resetDb.close();
                    return callback(insertError);
                }
                
                // Add bulk stock for accessories
                resetDb.run(`
                    INSERT INTO bulk_stock (product_version_id, quantity) VALUES
                    (9, 50),  -- Screen protectors
                    (10, 30)  -- Phone cases
                `, (bulkError) => {
                    if (bulkError) {
                        console.error('Bulk stock insertion failed:', bulkError);
                        resetDb.close();
                        return callback(bulkError);
                    }
                    
                    // Add sample deliveries
                    resetDb.run(`
                        INSERT INTO deliveries (id, delivery_number, delivery_date, supplier, status) VALUES
                        (1, 'WS0001', '2025-01-10', 'Apple Distribution Europe', 'booked'),
                        (2, 'WS0002', '2025-01-12', 'Samsung Electronics Benelux', 'booked'),
                        (3, 'WS0003', '2025-01-15', 'Xiaomi Global Distribution', 'booked')
                    `, (deliveryError) => {
                        if (deliveryError) {
                            console.error('Delivery data insertion failed:', deliveryError);
                            resetDb.close();
                            return callback(deliveryError);
                        }
                        
                        // Add sample delivery lines
                        resetDb.run(`
                            INSERT INTO delivery_lines (delivery_id, product_version_id, quantity, purchase_price_per_unit) VALUES
                            -- Apple delivery
                            (1, 1, 5, 899.00),    -- iPhone 15 Pro
                            (1, 2, 3, 799.00),    -- iPhone 15
                            (1, 6, 4, 249.00),    -- AirPods Pro
                            (1, 7, 2, 399.00),    -- Apple Watch
                            -- Samsung delivery
                            (2, 3, 4, 849.00),    -- Galaxy S24
                            (2, 4, 2, 1199.00),   -- Galaxy S24 Ultra
                            (2, 8, 3, 299.00),    -- Galaxy Watch
                            -- Xiaomi delivery
                            (3, 5, 6, 699.00),    -- Xiaomi 14
                            (3, 9, 50, 12.99),    -- Screen protectors
                            (3, 10, 30, 19.99)    -- Phone cases
                        `, (lineError) => {
                            if (lineError) {
                                console.error('Delivery lines insertion failed:', lineError);
                                resetDb.close();
                                return callback(lineError);
                            }
                            
                            // Add sample device identifiers with some defective items
                            resetDb.run(`
                                INSERT INTO device_identifiers 
                                (product_version_id, delivery_id, imei, serial_number, status, received_damaged, damage_description, purchase_price) VALUES
                                -- iPhone 15 Pro (IMEI tracking)
                                (1, 1, '351234567890101', NULL, 'in_stock', 0, NULL, 899.00),
                                (1, 1, '351234567890102', NULL, 'in_stock', 0, NULL, 899.00),
                                (1, 1, '351234567890103', NULL, 'defective_at_delivery', 1, 'Screen cracked during shipping', 899.00),
                                (1, 1, '351234567890104', NULL, 'in_stock', 0, NULL, 899.00),
                                (1, 1, '351234567890105', NULL, 'sold', 0, NULL, 899.00),
                                -- iPhone 15 (IMEI tracking)
                                (2, 1, '351234567890201', NULL, 'in_stock', 0, NULL, 799.00),
                                (2, 1, '351234567890202', NULL, 'in_stock', 0, NULL, 799.00),
                                (2, 1, '351234567890203', NULL, 'in_stock', 0, NULL, 799.00),
                                -- Galaxy S24 (IMEI tracking)
                                (3, 2, '351234567890301', NULL, 'in_stock', 0, NULL, 849.00),
                                (3, 2, '351234567890302', NULL, 'in_stock', 0, NULL, 849.00),
                                (3, 2, '351234567890303', NULL, 'sold', 0, NULL, 849.00),
                                (3, 2, '351234567890304', NULL, 'in_stock', 0, NULL, 849.00),
                                -- Galaxy S24 Ultra (IMEI tracking)
                                (4, 2, '351234567890401', NULL, 'in_stock', 0, NULL, 1199.00),
                                (4, 2, '351234567890402', NULL, 'defective_at_delivery', 1, 'Minor scratches on back panel', 1199.00),
                                -- Xiaomi 14 (IMEI tracking)
                                (5, 3, '351234567890501', NULL, 'in_stock', 0, NULL, 699.00),
                                (5, 3, '351234567890502', NULL, 'in_stock', 0, NULL, 699.00),
                                (5, 3, '351234567890503', NULL, 'in_stock', 0, NULL, 699.00),
                                (5, 3, '351234567890504', NULL, 'reserved', 0, NULL, 699.00),
                                (5, 3, '351234567890505', NULL, 'in_stock', 0, NULL, 699.00),
                                (5, 3, '351234567890506', NULL, 'sold', 0, NULL, 699.00),
                                -- AirPods Pro (Serial tracking)
                                (6, 1, NULL, 'AP2UC24001', 'in_stock', 0, NULL, 249.00),
                                (6, 1, NULL, 'AP2UC24002', 'in_stock', 0, NULL, 249.00),
                                (6, 1, NULL, 'AP2UC24003', 'sold', 0, NULL, 249.00),
                                (6, 1, NULL, 'AP2UC24004', 'defective_at_delivery', 1, 'Charging case dented', 249.00),
                                -- Apple Watch Series 9 (Serial tracking)
                                (7, 1, NULL, 'AW9S44001', 'in_stock', 0, NULL, 399.00),
                                (7, 1, NULL, 'AW9S44002', 'sold', 0, NULL, 399.00),
                                -- Galaxy Watch 6 (Serial tracking)
                                (8, 2, NULL, 'GW6S44001', 'in_stock', 0, NULL, 299.00),
                                (8, 2, NULL, 'GW6S44002', 'in_stock', 0, NULL, 299.00),
                                (8, 2, NULL, 'GW6S44003', 'missing', 0, NULL, 299.00)
                            `, (itemError) => {
                                if (itemError) {
                                    console.error('Device identifiers insertion failed:', itemError);
                                    resetDb.close();
                                    return callback(itemError);
                                }
                                
                                // Add status history for the identifiers
                                resetDb.run(`
                                    INSERT INTO status_history (device_identifier_id, old_status, new_status, changed_by, note) VALUES
                                    -- Delivery bookings (initial status)
                                    (1, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (2, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (3, NULL, 'defective_at_delivery', 'system', 'Defect geconstateerd bij levering - Screen cracked during shipping'),
                                    (4, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (5, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (6, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (7, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    (8, NULL, 'in_stock', 'system', 'Ingeboekt via levering WS0001'),
                                    -- Sales
                                    (5, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
                                    (11, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
                                    (21, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
                                    (25, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
                                    (28, 'in_stock', 'sold', 'admin', 'Verkocht aan klant'),
                                    -- Reservations
                                    (18, 'in_stock', 'reserved', 'admin', 'Gereserveerd voor klant pickup'),
                                    -- Missing items
                                    (27, 'in_stock', 'missing', 'admin', 'Niet gevonden bij inventarisatie')
                                `, (historyError) => {
                                    if (historyError) {
                                        console.error('Status history insertion failed:', historyError);
                                        resetDb.close();
                                        return callback(historyError);
                                    }
                                    
                                    console.log('Fresh mobile retail sample data inserted successfully!');
                                    resetDb.close();
                                    callback(null);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

app.post('/admin/reset-database', (req, res) => {
    console.log('Admin database reset requested...');
    
    // Close the current database connection first
    db.close((closeErr) => {
        if (closeErr) {
            console.error('Error closing database:', closeErr);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to close database connection: ' + closeErr.message 
            });
        }
        
        console.log('Database connection closed, executing reset...');
        
        resetDatabaseToDefaults((resetError) => {
            if (resetError) {
                console.error('Database reset failed:', resetError);
                
                // Reconnect to database even if reset failed
                db = new sqlite3.Database(dbPath);
                
                return res.status(500).json({ 
                    success: false, 
                    error: 'Database reset failed: ' + resetError.message
                });
            }
            
            console.log('Database reset completed successfully');
            
            // Reconnect to the fresh database
            db = new sqlite3.Database(dbPath, (reconnectErr) => {
                if (reconnectErr) {
                    console.error('Failed to reconnect to database:', reconnectErr);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Failed to reconnect to database: ' + reconnectErr.message 
                    });
                } else {
                    console.log('Database reconnected successfully');
                    res.json({ 
                        success: true, 
                        message: 'Database has been successfully reset to initial data.' 
                    });
                }
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
