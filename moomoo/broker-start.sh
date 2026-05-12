#!/bin/bash
# start_broker.sh — Start the Quant IQ broker bridge
# Place this alongside simulated_broker.py and broker_service.py

# Config (override via env vars)
export OPEND_HOST="${OPEND_HOST:-127.0.0.1}"
export OPEND_PORT="${OPEND_PORT:-11111}"
export SERVICE_PORT="${SERVICE_PORT:-8765}"
export INITIAL_CASH="${INITIAL_CASH:-100000}"
export SLIPPAGE_BPS="${SLIPPAGE_BPS:-2.0}"
export MAX_DAILY_TRADES="${MAX_DAILY_TRADES:-1}"
export MAX_POSITION_PCT="${MAX_POSITION_PCT:-5.0}"

echo "Starting Quant IQ broker bridge..."
echo "  OpenD:   $OPEND_HOST:$OPEND_PORT"
echo "  Service: http://localhost:$SERVICE_PORT"
echo ""
echo "Make sure OpenD is running and logged in first."
echo ""

python broker_service.py
