#!/bin/bash

# Stop any existing processes
killall -9 node 2>/dev/null

# Start Shopify CLI
echo "🚀 Starting Shopify CLI..."
npm run dev > /tmp/shopify-cli.log 2>&1 &
SHOPIFY_PID=$!

# Wait for Shopify CLI to initialize
echo "⏳ Waiting for Shopify CLI to initialize..."
sleep 15

# Load .env variables (bash compatible way)
set -a
[ -f .env ] && . .env
set +a
export SHOPIFY_APP_URL=https://localhost:3000

# Start Vite dev server
echo "🚀 Starting Vite dev server..."
npx vite --host localhost --port 3000 > /tmp/vite-server.log 2>&1 &
VITE_PID=$!

# Wait a bit for Vite to start
sleep 5

# Start Workers (for processing webhooks and queues)
echo "🚀 Starting Workers..."
npm run workers:dev > /tmp/workers.log 2>&1 &
WORKERS_PID=$!

echo ""
echo "✅ All services started!"
echo "   Shopify CLI PID: $SHOPIFY_PID"
echo "   Vite PID: $VITE_PID"
echo "   Workers PID: $WORKERS_PID"
echo ""
echo "📋 Logs:"
echo "   Shopify CLI: tail -f /tmp/shopify-cli.log"
echo "   Vite: tail -f /tmp/vite-server.log"
echo "   Workers: tail -f /tmp/workers.log"
echo ""
echo "🌐 Open: https://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Function to cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Stopping all services..."
  kill $SHOPIFY_PID 2>/dev/null
  kill $VITE_PID 2>/dev/null
  kill $WORKERS_PID 2>/dev/null
  exit 0
}

# Trap Ctrl+C
trap cleanup INT

# Wait for user interrupt
wait
