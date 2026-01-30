#!/bin/bash

# Start the app with a custom cloudflared tunnel so that
# MULTIPLE Shopify stores can access it simultaneously.
#
# How it works:
#   1. Starts cloudflared tunnel → localhost:3000
#   2. Runs `shopify app dev --tunnel-url` for EACH store sequentially
#      to create dev previews (Shopify isolates URL per dev store)
#   3. Kills shopify app dev, starts Vite directly on port 3000
#   4. Starts BullMQ workers
#   5. Cleans old webhooks + registers new ones
#
# Usage:
#   npm run start:multi

STORE1="pros-cons-shop-test.myshopify.com"
STORE2="ds-test-store-6408.myshopify.com"

echo ""
echo "=========================================="
echo "  Store Sync App - Multi-Store Mode"
echo "=========================================="
echo ""

# --- Cleanup on exit ---
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $TUNNEL_PID 2>/dev/null
  kill $VITE_PID 2>/dev/null
  kill $WORKERS_PID 2>/dev/null
  kill $TAIL_PID 2>/dev/null
  wait $TUNNEL_PID 2>/dev/null
  wait $VITE_PID 2>/dev/null
  wait $WORKERS_PID 2>/dev/null
  echo "All processes stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

# --- Step 1: Start cloudflared tunnel ---
echo "[1/6] Starting cloudflared tunnel..."
cloudflared tunnel --url http://localhost:3000 > /tmp/store-sync-cloudflared.log 2>&1 &
TUNNEL_PID=$!

TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9_-]+\.trycloudflare\.com' /tmp/store-sync-cloudflared.log 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
  echo "  ERROR: Could not detect tunnel URL."
  cleanup
  exit 1
fi

echo "  Tunnel: $TUNNEL_URL"

# --- Step 2: Create dev preview for Store 1 ---
echo ""
echo "[2/6] Creating dev preview for Store 1 ($STORE1)..."
shopify app dev --tunnel-url "${TUNNEL_URL}:3000" --store "$STORE1" > /tmp/store-sync-dev1.log 2>&1 &
DEV1_PID=$!

for i in $(seq 1 120); do
  if grep -q "Using URL:" /tmp/store-sync-dev1.log 2>/dev/null; then
    echo "  Store 1 dev preview created"
    break
  fi
  if ! kill -0 $DEV1_PID 2>/dev/null; then
    echo "  Store 1 setup exited. Check /tmp/store-sync-dev1.log"
    break
  fi
  sleep 2
done

kill $DEV1_PID 2>/dev/null
wait $DEV1_PID 2>/dev/null
# Free port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 2

# --- Step 3: Create dev preview for Store 2 ---
echo ""
echo "[3/6] Creating dev preview for Store 2 ($STORE2)..."
shopify app dev --tunnel-url "${TUNNEL_URL}:3000" --store "$STORE2" > /tmp/store-sync-dev2.log 2>&1 &
DEV2_PID=$!

for i in $(seq 1 120); do
  if grep -q "Using URL:" /tmp/store-sync-dev2.log 2>/dev/null; then
    echo "  Store 2 dev preview created"
    break
  fi
  if ! kill -0 $DEV2_PID 2>/dev/null; then
    echo "  Store 2 setup exited. Check /tmp/store-sync-dev2.log"
    break
  fi
  sleep 2
done

kill $DEV2_PID 2>/dev/null
wait $DEV2_PID 2>/dev/null
# Free port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 2

# --- Step 4: Start Vite directly ---
echo ""
echo "[4/6] Starting Vite dev server..."
SHOPIFY_APP_URL="$TUNNEL_URL" npx vite --host localhost --port 3000 > /tmp/store-sync-vite.log 2>&1 &
VITE_PID=$!

for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "  Vite ready on http://localhost:3000"
    break
  fi
  sleep 1
done

# --- Step 5: Start workers ---
echo ""
echo "[5/6] Starting workers..."
npm run workers:dev > /tmp/store-sync-workers.log 2>&1 &
WORKERS_PID=$!
echo "  Workers started (PID: $WORKERS_PID)"

# --- Step 6: Register webhooks ---
echo ""
echo "[6/6] Cleaning old webhooks + registering new ones..."
WEBHOOK_URL="$TUNNEL_URL" npx tsx scripts/register-webhooks-graphql.ts 2>&1 | grep -v "^prisma:query"

# --- Done ---
echo ""
echo "=========================================="
echo "  All systems running! (Multi-Store Mode)"
echo ""
echo "  Tunnel:   $TUNNEL_URL"
echo "  Vite:     http://localhost:3000 (PID: $VITE_PID)"
echo "  Workers:  running (PID: $WORKERS_PID)"
echo ""
echo "  Store 1:  https://admin.shopify.com/store/pros-cons-shop-test/apps/test-app-credention"
echo "  Store 2:  https://admin.shopify.com/store/ds-test-store-6408/apps/test-app-credention"
echo ""
echo "  Press Ctrl+C to stop everything"
echo "=========================================="
echo ""

# --- Tail logs ---
tail -f /tmp/store-sync-vite.log /tmp/store-sync-workers.log 2>/dev/null &
TAIL_PID=$!

wait $VITE_PID 2>/dev/null

kill $TUNNEL_PID 2>/dev/null
kill $WORKERS_PID 2>/dev/null
kill $TAIL_PID 2>/dev/null
