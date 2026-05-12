"""
quant_iq_quote_test.py
Moomoo API — Quote Connection Test for Quant IQ Platform
Tests: US stock snapshots, real-time subscription, historical candles,
       and US options chain data.

Requirements:
  - OpenD must be running and logged in before executing this script
  - pip install moomoo-api
  - Nasdaq Basic quote card activated for real-time US stock data
  - US options quote permission (free if total assets > $3,000 + have traded)

Usage:
  python quant_iq_quote_test.py
"""

import moomoo as ft
import time
import sys

# ─── CONFIG ────────────────────────────────────────────────────────────────────
OPEND_HOST = "127.0.0.1"   # Change to your VPS IP for cloud deployment
OPEND_PORT = 11111          # Must match your OpenD api_port setting

# Test symbols — US stocks and ETFs
US_STOCKS = ["US.AAPL", "US.TSLA", "US.NVDA", "US.SPY", "US.QQQ"]

# One stock to use for deep tests (subscription, candles, options chain)
PRIMARY_STOCK = "US.AAPL"

# ─── HELPERS ───────────────────────────────────────────────────────────────────
def section(title):
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")

def ok(msg):
    print(f"  ✓  {msg}")

def fail(msg):
    print(f"  ✗  {msg}")

def info(msg):
    print(f"     {msg}")


# ─── TEST 1: CONNECTION ────────────────────────────────────────────────────────
section("TEST 1 — OpenD Connection")
try:
    quote_ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
    ok(f"Connected to OpenD at {OPEND_HOST}:{OPEND_PORT}")
except Exception as e:
    fail(f"Could not connect to OpenD: {e}")
    fail("Make sure OpenD is running and logged in before running this script.")
    sys.exit(1)


# ─── TEST 2: MARKET SNAPSHOT ───────────────────────────────────────────────────
section("TEST 2 — US Stock Market Snapshot")
ret, data = quote_ctx.get_market_snapshot(US_STOCKS)
if ret == ft.RET_OK:
    ok(f"Snapshot received for {len(data)} symbols")
    print()
    for _, row in data.iterrows():
        status = "🟢" if row.get("last_price", 0) > 0 else "⚪"
        print(f"  {status}  {row['code']:<12}"
              f"  Last: ${row.get('last_price', 'N/A'):<10}"
              f"  Bid: ${row.get('bid_price', 'N/A'):<10}"
              f"  Ask: ${row.get('ask_price', 'N/A'):<10}"
              f"  Vol: {row.get('volume', 'N/A')}")
else:
    fail(f"Snapshot failed: {data}")
    info("Check your Nasdaq Basic quote card is active.")


# ─── TEST 3: REAL-TIME SUBSCRIPTION ───────────────────────────────────────────
section("TEST 3 — Real-Time Quote Subscription")

class QuoteHandler(ft.StockQuoteHandlerBase):
    """Callback handler — fires whenever a subscribed symbol quote updates."""
    received = 0

    def on_recv_rsp(self, rsp_str):
        ret, data = super().on_recv_rsp(rsp_str)
        if ret == ft.RET_OK and QuoteHandler.received < 3:
            QuoteHandler.received += 1
            row = data.iloc[0]
            info(f"Push #{QuoteHandler.received}: {row['code']}  "
                 f"Last=${row.get('last_price', '?')}  "
                 f"Vol={row.get('volume', '?')}")
        return ret, data

quote_ctx.start()
quote_ctx.set_handler(QuoteHandler())

ret, err = quote_ctx.subscribe(
    [PRIMARY_STOCK],
    [ft.SubType.QUOTE, ft.SubType.ORDER_BOOK, ft.SubType.TICKER]
)

if ret == ft.RET_OK:
    ok(f"Subscribed to QUOTE + ORDER_BOOK + TICKER for {PRIMARY_STOCK}")
    info("Waiting up to 5s for real-time push data...")
    time.sleep(5)
    if QuoteHandler.received > 0:
        ok(f"Real-time pushes received: {QuoteHandler.received}")
    else:
        info("No pushes received — market may be closed or outside trading hours.")
else:
    fail(f"Subscription failed: {err}")


# ─── TEST 4: CURRENT QUOTE (PULL) ─────────────────────────────────────────────
section("TEST 4 — Pull Current Quote")
ret, data = quote_ctx.get_stock_quote([PRIMARY_STOCK])
if ret == ft.RET_OK:
    row = data.iloc[0]
    ok(f"Quote pulled for {row['code']}")
    info(f"Last:     ${row.get('last_price', 'N/A')}")
    info(f"Open:     ${row.get('open_price', 'N/A')}")
    info(f"High:     ${row.get('high_price', 'N/A')}")
    info(f"Low:      ${row.get('low_price', 'N/A')}")
    info(f"Prev Close: ${row.get('prev_close_price', 'N/A')}")
    info(f"Volume:   {row.get('volume', 'N/A')}")
    info(f"Turnover: {row.get('turnover', 'N/A')}")
else:
    fail(f"Pull quote failed: {data}")


# ─── TEST 5: ORDER BOOK ────────────────────────────────────────────────────────
section("TEST 5 — Order Book (Level 2)")
ret, data = quote_ctx.get_order_book(PRIMARY_STOCK, num=5)
if ret == ft.RET_OK:
    ok(f"Order book received for {PRIMARY_STOCK}")
    asks = data.get("Ask", [])
    bids = data.get("Bid", [])
    info(f"Top 5 Asks (sell side):")
    for ask in asks[:5]:
        info(f"    Price: ${ask[0]}  Volume: {ask[1]}  Orders: {ask[2]}")
    info(f"Top 5 Bids (buy side):")
    for bid in bids[:5]:
        info(f"    Price: ${bid[0]}  Volume: {bid[1]}  Orders: {bid[2]}")
else:
    fail(f"Order book failed: {data}")
    info("Requires Nasdaq Basic+TotalView (LV2) quote card for full order book.")


# ─── TEST 6: HISTORICAL CANDLES ────────────────────────────────────────────────
section("TEST 6 — Historical Daily Candles (last 10 days)")
ret, data, page_req_key = quote_ctx.request_history_kline(
    PRIMARY_STOCK,
    start=None,       # None = pull most recent
    end=None,
    ktype=ft.KLType.K_DAY,
    autype=ft.AuType.QFQ,   # Forward-adjusted prices
    fields=[
        ft.KL_FIELD.DATE_TIME,
        ft.KL_FIELD.OPEN,
        ft.KL_FIELD.HIGH,
        ft.KL_FIELD.LOW,
        ft.KL_FIELD.CLOSE,
        ft.KL_FIELD.TRADE_VOL
    ],
    max_count=10
)
if ret == ft.RET_OK:
    ok(f"Historical candles received: {len(data)} bars")
    print()
    print(f"  {'Date':<14} {'Open':>8} {'High':>8} {'Low':>8} {'Close':>8} {'Volume':>12}")
    print(f"  {'─'*14} {'─'*8} {'─'*8} {'─'*8} {'─'*8} {'─'*12}")
    for _, row in data.iterrows():
        print(f"  {str(row['time_key'])[:10]:<14}"
              f" {row['open']:>8.2f}"
              f" {row['high']:>8.2f}"
              f" {row['low']:>8.2f}"
              f" {row['close']:>8.2f}"
              f" {int(row['volume']):>12,}")
else:
    fail(f"Historical candles failed: {data}")


# ─── TEST 7: OPTIONS CHAIN ─────────────────────────────────────────────────────
section("TEST 7 — Options Chain (nearest expiry)")
ret, dates = quote_ctx.get_option_expiration_date(code=PRIMARY_STOCK)
if ret == ft.RET_OK and len(dates) > 0:
    nearest_expiry = dates.iloc[0]["strike_time"]
    ok(f"Nearest options expiry for {PRIMARY_STOCK}: {nearest_expiry}")

    ret2, chain = quote_ctx.get_option_chain(
        code=PRIMARY_STOCK,
        start=nearest_expiry,
        end=nearest_expiry,
        option_type=ft.OptionType.ALL,
        option_cond_type=ft.OptionCondType.ALL
    )
    if ret2 == ft.RET_OK:
        ok(f"Options chain received: {len(chain)} contracts")
        calls = chain[chain["option_type"] == "CALL"].head(3)
        puts  = chain[chain["option_type"] == "PUT"].head(3)
        info(f"Sample CALL contracts:")
        for _, row in calls.iterrows():
            info(f"    {row.get('code', 'N/A')}  Strike: {row.get('strike_price', 'N/A')}")
        info(f"Sample PUT contracts:")
        for _, row in puts.iterrows():
            info(f"    {row.get('code', 'N/A')}  Strike: {row.get('strike_price', 'N/A')}")
    else:
        fail(f"Options chain failed: {chain}")
        info("Requires OPRA options quote permission.")
else:
    fail(f"Could not fetch options expiry dates: {dates}")
    info("Requires OPRA options quote permission (free if assets > $3K + have traded).")


# ─── TEST 8: SUBSCRIPTION QUOTA CHECK ─────────────────────────────────────────
section("TEST 8 — Subscription Quota Usage")
ret, data = quote_ctx.query_subscription(is_all_conn=False)
if ret == ft.RET_OK:
    ok("Subscription quota info retrieved")
    info(f"Used quota:  {data.get('used_quota', 'N/A')}")
    info(f"Total quota: {data.get('total_quota', 'N/A')}")
    info(f"Active subs: {data.get('sub_list', [])}")
else:
    fail(f"Quota query failed: {data}")


# ─── CLEANUP ───────────────────────────────────────────────────────────────────
section("CLEANUP")
quote_ctx.unsubscribe(
    [PRIMARY_STOCK],
    [ft.SubType.QUOTE, ft.SubType.ORDER_BOOK, ft.SubType.TICKER]
)
ok(f"Unsubscribed from {PRIMARY_STOCK}")

quote_ctx.close()
ok("QuoteContext closed cleanly")

section("ALL TESTS COMPLETE")
print()
