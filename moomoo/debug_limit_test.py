"""
debug_limit_test.py — isolate the limit fill issue
"""
import logging
import time
import moomoo as ft
from simulated_broker import SimulatedBroker, OrderSide, OrderType

logging.basicConfig(level=logging.DEBUG,
                    format="%(asctime)s | %(levelname)s | %(message)s")

broker = SimulatedBroker(initial_cash=100_000.0)
broker.connect()
time.sleep(2)

# Fetch current ask
ret, snap = broker._quote_ctx.get_market_snapshot(["US.AAPL"])
current_ask = snap.iloc[0]["ask_price"]
limit_price  = round(current_ask * 1.05, 2)   # 5% above ask — definitely should fill

print(f"\nCurrent ask: ${current_ask:.4f}  Limit price: ${limit_price:.4f}")
print(f"Cache before order: {broker._price_cache.get('US.AAPL')}\n")

order_id = broker.place_order(
    symbol      = "US.AAPL",
    side        = OrderSide.BUY,
    qty         = 1,
    order_type  = OrderType.LIMIT,
    limit_price = limit_price,
)

print(f"\nCache after place_order: {broker._price_cache.get('US.AAPL')}\n")

for i in range(5):
    time.sleep(0.5)
    broker.run_fill_cycle()
    order = broker.get_order(order_id)
    print(f"Attempt {i+1}: status={order.status.value} fill_price={order.fill_price}")
    if order.status.value == "FILLED":
        break

broker.disconnect()
