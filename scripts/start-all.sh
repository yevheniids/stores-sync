#!/bin/bash

# Start everything in one terminal.
# Usage:
#   npm run start:all        — with product sync
#   npm run start:all:quick  — without product sync (faster)

SKIP_SYNC=${SKIP_SYNC:-false}

echo ""
echo "=========================================="
echo "  Store Sync App - Full Start"
echo "=========================================="
echo ""

# --- Step 1: Product sync removed (use Sync button in Dashboard instead) ---
echo "[1/4] Product sync is now manual (use Dashboard > Sync to Database)"
echo ""

# --- Step 2: Start workers ---
echo "[2/4] Starting workers..."
npm run workers:dev > /tmp/store-sync-workers.log 2>&1 &
WORKERS_PID=$!
echo "  Workers started (PID: $WORKERS_PID)"

# --- Cleanup on exit ---
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $WORKERS_PID 2>/dev/null
  kill $TUNNEL_PID 2>/dev/null
  kill $TAIL_PID 2>/dev/null
  wait $WORKERS_PID 2>/dev/null
  wait $TUNNEL_PID 2>/dev/null
  echo "All processes stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

# --- Step 3: Start tunnel ---
echo "[3/4] Starting tunnel..."
npm run dev:tunnel > /tmp/store-sync-tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "  Tunnel starting (PID: $TUNNEL_PID)"
echo ""

# --- Step 4: Wait for tunnel URL and register webhooks ---
echo "[4/4] Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9_-]+\.trycloudflare\.com' /tmp/store-sync-tunnel.log 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 2
done

if [ -z "$TUNNEL_URL" ]; then
  echo "  Could not detect tunnel URL after 120s."
  echo "  Check /tmp/store-sync-tunnel.log for details."
  echo "  You can manually register webhooks:"
  echo "  WEBHOOK_URL=https://YOUR-TUNNEL npm run register-webhooks"
else
  echo "  Tunnel URL: $TUNNEL_URL"
  echo ""
  echo "  Registering webhooks for all active stores..."
  WEBHOOK_URL="$TUNNEL_URL" npx tsx scripts/register-webhooks-graphql.ts 2>&1 | grep -v "^prisma:query"
  echo ""
  echo "=========================================="
  echo "  All systems running!"
  echo ""
  echo "  App:      $TUNNEL_URL"
  echo "  Workers:  running (PID: $WORKERS_PID)"
  echo "  Webhooks: registered"
  echo ""
  echo "  Press Ctrl+C to stop everything"
  echo "=========================================="
fi

echo ""

# --- Tail logs ---
tail -f /tmp/store-sync-tunnel.log /tmp/store-sync-workers.log 2>/dev/null &
TAIL_PID=$!

wait $TUNNEL_PID 2>/dev/null

kill $WORKERS_PID 2>/dev/null
kill $TAIL_PID 2>/dev/null
