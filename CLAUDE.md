# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Product Identifier Tracking System (POC) built with Node.js and SQLite. The system manages mobile retail products with configurable tracking modes (IMEI, serial number, or bulk) and provides complete audit trails for all operations.

## Development Commands

```bash
# Start the development server (auto-restart on changes)
npm run dev

# Start the production server
npm start

# Initialize the database schema
npm run init-db

# Reset database and populate with sample data
npm run reset-db
```

## Database Management

The system uses SQLite with database file at `./database.sqlite`. Key scripts:
- `scripts/init-db.js` - Creates database schema and initial sample data
- `scripts/reset-and-seed.js` - Full database reset with mobile retail sample data

## Architecture Overview

### Core Entity Model
- **Product Versions**: Configurable tracking modes (none/IMEI/serial)
- **Device Identifiers**: Individual tracked items with IMEI/serial numbers
- **Deliveries**: Immutable delivery records with booking workflow
- **Audit Trails**: Complete history for all identifier/status changes

### Key Tables
- `product_versions` - Product catalog with tracking configuration
- `device_identifiers` - Individual tracked items (phones, watches)
- `deliveries` + `delivery_lines` - Delivery management with purchase prices
- `bulk_stock` - Non-tracked item quantities (accessories)
- History tables for audit trails (`status_history`, `identifier_history`, etc.)

### Tracking Modes
- **None**: Bulk stock management (accessories like cases, cables)
- **IMEI**: Individual tracking for mobile phones
- **Serial**: Individual tracking for smartwatches and other devices

### Server Architecture
- Single-file Express.js server (`server.js`)
- EJS templating with partials in `views/`
- SQLite database with manual SQL queries
- RESTful routes for CRUD operations

## Key Business Rules

### Identifier Management
- IMEI and serial numbers must be globally unique
- Only items with status "in_stock" can be modified (swapped/clearance)
- Original values preserved for delivery audit integrity
- Tracking mode compatibility required for product version swaps

### Delivery Workflow
- Deliveries start in "concept" status (editable)
- Booking makes deliveries immutable
- All delivery data remains unchanged post-booking
- Individual identifiers created during booking for tracked items

### Data Integrity
- Delivery records are immutable after booking
- All changes logged in audit trail tables
- Original identifier values preserved for delivery integrity
- Purchase prices tracked per identifier and delivery line

## File Structure

```
server.js           # Main Express application
package.json        # Dependencies and scripts
database.sqlite     # SQLite database file
scripts/
  init-db.js        # Database initialization
  reset-and-seed.js # Reset with sample data
views/
  *.ejs            # EJS templates
  partials/        # Shared template components
epic/
  *.txt            # Project documentation and requirements
```

## Development Notes

- No test framework configured - tests should be added manually
- No linting configured - code style is manual
- Single-file server architecture for POC simplicity
- Manual SQL queries (no ORM) for direct database control
- EJS templating with Bootstrap for UI
- Sample data focuses on mobile retail (phones, watches, accessories)

## Common Development Tasks

When adding new features, follow these patterns:
- Add new database tables in `scripts/init-db.js` 
- Create corresponding EJS views in `views/`
- Add Express routes in `server.js` following existing pattern
- Include audit trail logging for all data changes
- Validate business rules in route handlers

## Important Constraints

- Deliveries become immutable after booking - never modify delivery data post-booking
- Always preserve original identifier values for delivery audit trail
- Respect tracking mode compatibility when implementing swaps
- Maintain referential integrity between related entities