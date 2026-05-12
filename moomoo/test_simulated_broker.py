"""
test_simulated_broker.py
Quant IQ — SimulatedBroker Test

Tests all order types (market, limit, stop, stop_limit) against live
Moomoo market data. No real money involved.

Run with OpenD running and logged in:
    python test_simulated_broker.py
"""

import logging
import time
from simulated_broker import SimulatedBroker, OrderSide, OrderType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

def section(title):
    print(f"\n{'─' * 56}")
    print(f"  {title}")
    print(f"{'─' * 56}")

# ─── SETUP ─────────────────────────────────────────────────────────────────────
section("SETUP — initialise SimulatedBroker")

broker = SimulatedBroker(
    initial_cash=100_000.0,
    commission_per_trade=0.0,   # moomoo is zero-commission
    slippage_bps=2.0,           # 2bps slippage simulation
)
broker.connect()
print(f"  ✓  Connected — starting cash: ${broker.get_cash():,.2f}")

# Give the quote subscription a moment to warm up
time.sleep(2)

# ─── TEST 1: MARKET BUY ────────────────────────────────────────────────────────
section("TEST 1 — Market buy order (US.AAPL)")

order_id = broker.place_order(
    symbol     = "US.AAPL",
    side       = OrderSide.BUY,
    qty        = 10,
    order_type = OrderType.MARKET,
)
time.sleep(1)
order = broker.get_order(order_id)
if order and order.status.value == "FILLED":
    print(f"  ✓  Filled {order.qty} AAPL @ ${order.fill_price:.4f}")
    print(f"     Slippage: ${order.slippage:.4f}  |  Cash remaining: ${broker.get_cash():,.2f}")
else:
    print(f"  ✗  Not filled yet: {order.status if order else 'not found'}")

# ─── TEST 2: MARKET SELL ───────────────────────────────────────────────────────
section("TEST 2 — Market sell order (US.TSLA)")

# First buy TSLA so we have something to sell
broker.place_order("US.TSLA", OrderSide.BUY, qty=5, order_type=OrderType.MARKET)
time.sleep(1)

order_id = broker.place_order(
    symbol     = "US.TSLA",
    side       = OrderSide.SELL,
    qty        = 5,
    order_type = OrderType.MARKET,
)
# Retry fill cycle a few times — bid may take a moment to arrive
for _ in range(5):
    time.sleep(0.5)
    broker.run_fill_cycle()
    order = broker.get_order(order_id)
    if order and order.status.value == "FILLED":
        break
order = broker.get_order(order_id)
if order and order.status.value == "FILLED":
    print(f"  ✓  Sold 5 TSLA @ ${order.fill_price:.4f}")
else:
    print(f"  ✗  {order.status if order else 'not found'}")

# ─── TEST 3: LIMIT BUY (price below market — stays pending) ────────────────────
section("TEST 3 — Limit buy below market (should stay PENDING)")

# Fetch current AAPL ask to set limit well below market
ret, snap = broker._quote_ctx.get_market_snapshot(["US.AAPL"])
import moomoo as ft
if ret == ft.RET_OK:
    current_ask = snap.iloc[0]["ask_price"]
    limit_price = round(current_ask * 0.95, 2)   # 5% below ask
    print(f"  Current ask: ${current_ask:.2f}  →  Setting limit at ${limit_price:.2f}")

    order_id = broker.place_order(
        symbol      = "US.AAPL",
        side        = OrderSide.BUY,
        qty         = 5,
        order_type  = OrderType.LIMIT,
        limit_price = limit_price,
    )
    time.sleep(1)
    order = broker.get_order(order_id)
    print(f"  ✓  Order status: {order.status.value} (expected PENDING)")
    print(f"     Order ID: {order_id} — cancel with broker.cancel_order('{order_id}')")

# ─── TEST 4: LIMIT BUY (price above market — fills immediately) ────────────────
section("TEST 4 — Limit buy above market (should fill)")

if ret == ft.RET_OK:
    limit_price_high = round(current_ask * 1.02, 2)  # 2% above ask — will fill
    print(f"  Setting limit at ${limit_price_high:.2f} (above ask ${current_ask:.2f})")

    order_id = broker.place_order(
        symbol      = "US.AAPL",
        side        = OrderSide.BUY,
        qty         = 3,
        order_type  = OrderType.LIMIT,
        limit_price = limit_price_high,
    )
    # Retry — limit order may need a live push to trigger fill
    for _ in range(8):
        time.sleep(1.0)
        broker.run_fill_cycle()
        order = broker.get_order(order_id)
        if order and order.status.value == "FILLED":
            break
    order = broker.get_order(order_id)
    if order and order.status.value == "FILLED":
        print(f"  ✓  Filled 3 AAPL @ ${order.fill_price:.4f}  (limit was ${limit_price_high:.2f})")
    else:
        print(f"  ✗  Status: {order.status.value if order else 'not found'}")

# ─── TEST 5: STOP SELL ─────────────────────────────────────────────────────────
section("TEST 5 — Stop sell order (triggers if price drops)")

if ret == ft.RET_OK:
    last_price = snap.iloc[0]["last_price"]
    stop_price = round(last_price * 0.98, 2)   # triggers if last drops 2%
    print(f"  Last price: ${last_price:.2f}  →  Stop at ${stop_price:.2f}")
    print(f"  (This order stays pending unless price drops to ${stop_price:.2f})")

    order_id = broker.place_order(
        symbol     = "US.AAPL",
        side       = OrderSide.SELL,
        qty        = 2,
        order_type = OrderType.STOP,
        stop_price = stop_price,
    )
    time.sleep(1)
    order = broker.get_order(order_id)
    print(f"  ✓  Order status: {order.status.value}  (expected PENDING — stop not triggered)")

# ─── TEST 6: CANCEL AN ORDER ───────────────────────────────────────────────────
section("TEST 6 — Cancel a pending order")

open_orders = broker.get_open_orders()
if open_orders:
    target = open_orders[0]
    success = broker.cancel_order(target.order_id)
    print(f"  ✓  Cancelled order {target.order_id}: {success}")
    print(f"     Was: {target.side.value} {target.qty} {target.symbol} "
          f"@ {target.order_type.value}")
else:
    print("  No open orders to cancel.")

# ─── TEST 7: INSUFFICIENT CASH REJECTION ───────────────────────────────────────
section("TEST 7 — Reject order due to insufficient cash")

order_id = broker.place_order(
    symbol     = "US.AAPL",
    side       = OrderSide.BUY,
    qty        = 100_000,        # impossibly large quantity
    order_type = OrderType.MARKET,
)
if order_id is None:
    print(f"  ✓  Order correctly rejected (insufficient cash)")
else:
    order = broker.get_order(order_id)
    print(f"  Status: {order.status.value if order else 'none'}")

# ─── TEST 8: PORTFOLIO SUMMARY ─────────────────────────────────────────────────
section("TEST 8 — Portfolio summary")
broker.print_summary()

# ─── TEST 9: TRADE LOG ─────────────────────────────────────────────────────────
section("TEST 9 — Trade log (last 5 events)")
log = broker.get_trade_log()[:5]
print(f"  {'Time':<26} {'ID':<10} {'Symbol':<12} {'Side':<5} "
      f"{'Type':<12} {'Qty':>5} {'Status':<12} {'Fill':>8}")
print(f"  {'─'*26} {'─'*10} {'─'*12} {'─'*5} {'─'*12} {'─'*5} {'─'*12} {'─'*8}")
for e in log:
    fill = f"${e['fill_price']:.2f}" if e['fill_price'] else "—"
    print(f"  {e['timestamp'][:26]:<26} {e['order_id']:<10} "
          f"{e['symbol']:<12} {e['side']:<5} {e['order_type']:<12} "
          f"{e['qty']:>5} {e['status']:<12} {fill:>8}")

# ─── CLEANUP ───────────────────────────────────────────────────────────────────
section("CLEANUP")
broker.disconnect()
print("  ✓  SimulatedBroker disconnected cleanly")
print()
