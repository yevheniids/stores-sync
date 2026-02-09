
# 1. Install dependencies

npm install

# 2. Configure environment

cp .env.example .env

# Edit .env with your credentials

# 3. Setup database

npm run prisma:generate
npm run prisma:migrate

# 4. Link Shopify app

npm run config:link

# 5. Start development server

npm run dev

### Development

* npm run dev - Start dev server (localhost)
* npm run dev:tunnel - Start dev server (tunnel)
* npm run workers:dev - Start queue workers (watch mode)

### Database

* npm run prisma:generate - Generate Prisma client
* npm run prisma:migrate - Run migrations
* npm run prisma:studio - Open Prisma Studio
* npm run db:reset - Reset database

### Shopify

* npm run config:link - Link to Shopify app
* npm run register-webhooks - Register webhooks
* npm run sync:all - Sync all stores
* npm run sync:store1 - Sync store 1
* npm run sync:store2 - Sync store 2

### Build & Deploy

* npm run build - Build for production
* npm run deploy - Deploy to Shopify

### Testing

* npm run test - Run all tests
* npm run test:unit - Unit tests only
* npm run test:integration - Integration tests
* npm run test:e2e - E2E tests
* npm run test:coverage - Coverage report

### Code Quality

* npm run typecheck - Type check
* npm run lint - Lint code
* npm run format - Format code

### Workers & Services

* npm run workers - Start queue workers
* npm run start:all - Start all services
* npm run start:multi - Start multi-store setup
