# Shopify Inventory Sync App

A robust multi-store Shopify inventory synchronization application built with Remix, TypeScript, Supabase, and BullMQ.

## Overview

This application synchronizes inventory across multiple Shopify stores using a centralized database as the source of truth. It handles real-time updates via webhooks, manages conflicts intelligently, and provides a comprehensive audit trail.

## Tech Stack

- **Frontend**: Remix + React + Shopify Polaris UI
- **Backend**: Node.js + TypeScript
- **Database**: PostgreSQL (via Supabase) + Prisma ORM
- **Queue**: BullMQ + Redis
- **Real-time**: Supabase Realtime
- **Shopify Integration**: Shopify App Remix + GraphQL Admin API

## Features

- Multi-store inventory synchronization with SKU-based product mapping
- Real-time webhook processing for instant updates
- Conflict detection and resolution strategies
- Distributed job queue for scalable sync operations
- Comprehensive audit logging
- Rate limiting and retry mechanisms
- Idempotent webhook handling

## Project Structure

```
store-sync-app/
├── app/
│   ├── lib/                    # Utility libraries
│   │   ├── redis.server.ts     # Redis client and helpers
│   │   ├── supabase.server.ts  # Supabase client
│   │   └── queue.server.ts     # BullMQ queue configuration
│   ├── db.server.ts            # Prisma client
│   ├── shopify.server.ts       # Shopify app configuration
│   ├── entry.client.tsx        # Client entry point
│   ├── entry.server.tsx        # Server entry point
│   └── root.tsx                # Root layout
├── prisma/
│   └── schema.prisma           # Database schema
├── package.json
├── tsconfig.json
├── shopify.app.toml            # Shopify app configuration
└── .env.example                # Environment variables template
```

## Database Schema

### Core Tables

- **stores**: Connected Shopify stores with credentials
- **products**: Central product registry (SKU-based)
- **product_store_mappings**: Links central products to store variants
- **inventory**: Central inventory (source of truth)
- **webhook_events**: Webhook event tracking for idempotency
- **sync_operations**: Audit log of all sync operations
- **conflicts**: Detected conflicts with resolution strategies

### Conflict Resolution Strategies

- `USE_LOWEST`: Conservative approach (prevents overselling)
- `USE_HIGHEST`: Optimistic approach
- `USE_DATABASE`: Central database wins
- `USE_STORE`: Store value wins
- `MANUAL`: Requires human intervention

## Setup Instructions

### Prerequisites

- Node.js 18+
- PostgreSQL database (Supabase account)
- Redis instance
- Shopify Partner account

### 1. Clone and Install

```bash
cd /Users/eugene/Desktop/Projects/self-education/store-sync-app
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Fill in the required values:
- Shopify API credentials
- Database connection strings
- Redis connection details
- Supabase credentials

### 3. Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# (Optional) Open Prisma Studio
npm run prisma:studio
```

### 4. Shopify App Setup

```bash
# Link to your Shopify app
npm run config:link

# Start development server
npm run dev
```

### 5. Install App on Test Store

Visit the provided URL to install the app on your development store.

## Development

### Run Development Server

```bash
npm run dev
```

This starts:
- Remix development server (with HMR)
- Shopify CLI tunnel
- Webhook forwarding

### Database Migrations

```bash
# Create a new migration
npm run prisma:migrate

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Code Formatting

```bash
npm run format
```

## Architecture

### Synchronization Flow

1. **Webhook Received**: Store sends inventory update webhook
2. **Idempotency Check**: Verify webhook hasn't been processed
3. **Queue Job**: Add to BullMQ for processing
4. **Process Update**: Update central database
5. **Detect Conflicts**: Check for discrepancies with other stores
6. **Resolve Conflicts**: Apply configured resolution strategy
7. **Propagate Changes**: Sync to all connected stores
8. **Audit Log**: Record operation details

### Queue System

- **inventory-sync**: Real-time inventory synchronization
- **product-sync**: Product create/update/delete operations
- **webhook-processing**: Webhook event processing
- **batch-operations**: Bulk operations and initial syncs
- **conflict-resolution**: Automated conflict resolution
- **scheduled-sync**: Periodic full synchronizations

### Error Handling

- Automatic retries with exponential backoff
- Dead letter queue for failed jobs
- Comprehensive error logging
- Rate limit handling with retry-after

## API Endpoints (Coming in Phase 2)

- `POST /api/webhooks/inventory/update` - Inventory level updates
- `POST /api/webhooks/products/create` - Product creation
- `POST /api/webhooks/products/update` - Product updates
- `POST /api/webhooks/products/delete` - Product deletion
- `POST /api/webhooks/orders/create` - Order creation
- `POST /api/webhooks/app/uninstalled` - App uninstallation

## Security Considerations

- Access tokens encrypted at rest
- HMAC webhook verification
- Rate limiting on API endpoints
- Input validation and sanitization
- SQL injection prevention via Prisma
- Distributed locks for critical sections

## Performance Optimization

- Redis caching for frequently accessed data
- Batch GraphQL queries to Shopify
- Connection pooling for database
- Job queue for async operations
- Optimistic locking for concurrency

## Monitoring and Observability

- Queue statistics dashboard
- Sync operation audit trail
- Conflict detection alerts
- Failed job monitoring
- Database health checks
- Redis connection monitoring

## Deployment

### Environment Variables

Ensure all production environment variables are set:

```bash
# Shopify
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
HOST=https://your-app-domain.com

# Database (Supabase)
DATABASE_URL=
DIRECT_URL=

# Redis
REDIS_URL=

# Security
SESSION_SECRET=
```

### Build for Production

```bash
npm run build
```

### Deploy

```bash
npm run deploy
```

## Roadmap

### Phase 1: Project Setup ✓
- [x] Project structure
- [x] Database schema
- [x] Shopify app configuration
- [x] Queue system setup

### Phase 2: Core Sync Engine (Next)
- [ ] Webhook handlers
- [ ] Sync service implementation
- [ ] Conflict detection logic
- [ ] Queue workers

### Phase 3: Admin Dashboard
- [ ] Store management UI
- [ ] Product mapping interface
- [ ] Conflict resolution UI
- [ ] Sync history viewer

### Phase 4: Advanced Features
- [ ] Real-time dashboard updates
- [ ] Analytics and reporting
- [ ] Bulk operations UI
- [ ] Scheduled sync configuration

## Troubleshooting

### Database Connection Issues

```bash
# Test database connection
npx prisma db push
```

### Redis Connection Issues

```bash
# Test Redis connection
npm run test:redis
```

### Webhook Delivery Issues

- Check webhook registration in Shopify admin
- Verify HMAC signature validation
- Check firewall/network settings
- Review webhook event logs

## Contributing

This is an educational project. Contributions, issues, and feature requests are welcome!

## License

MIT

## Support

For issues and questions, please open a GitHub issue.
