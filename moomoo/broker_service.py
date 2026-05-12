"""
broker_service.py
Quant IQ — Broker Bridge Service

FastAPI wrapper around SimulatedBroker (and later LiveBroker).
Runs locally alongside OpenD on port 8765.

Start:
    pip install fastapi uvicorn moomoo-api
    python broker_service.py

Endpoints:
    GET  /status              — broker connection status + account summary
    GET  /positions           — all open positions with live P&L
    GET  /pnl                 — portfolio P&L summary
    GET  /orders              — all orders (open + history)
    GET  /orders/open         — pending orders only
    POST /orders              — place a new order
    DELETE /orders/{order_id} — cancel a pending order
    POST /connect             — (re)connect to OpenD
    POST /disconnect          — disconnect from OpenD
    GET  /health              — health check (no broker state needed)

Safety rules (automatic mode):
    - MAX_TRADES_PER_DAY_PER_TICKER: 1
    - MAX_POSITION_PCT: 5% of portfolio
    - No trading outside US market hours (9:30–16:00 ET)
    - Kill switch: POST /auto/disable
"""

import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, date, timezone, timedelta
from typing import Optional, Dict, List
from collections import defaultdict

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Import the SimulatedBroker — must be in the same directory
from simulated_broker import SimulatedBroker, OrderSide, OrderType, OrderStatus

# ── Config ────────────────────────────────────────────────────────────────────

OPEND_HOST            = os.getenv("OPEND_HOST",      "127.0.0.1")
OPEND_PORT            = int(os.getenv("OPEND_PORT",  "11111"))
SERVICE_PORT          = int(os.getenv("SERVICE_PORT","8765"))
INITIAL_CASH          = float(os.getenv("INITIAL_CASH", "100000"))
COMMISSION            = float(os.getenv("COMMISSION",   "0.0"))
SLIPPAGE_BPS          = float(os.getenv("SLIPPAGE_BPS", "2.0"))

# Safety rules
MAX_TRADES_PER_DAY_PER_TICKER = int(os.getenv("MAX_DAILY_TRADES", "1"))
MAX_POSITION_PCT               = float(os.getenv("MAX_POSITION_PCT", "5.0"))  # % of portfolio
MARKET_OPEN_ET                 = (9, 30)   # 09:30 ET
MARKET_CLOSE_ET                = (16, 0)   # 16:00 ET

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

broker: Optional[SimulatedBroker] = None
broker_lock = threading.Lock()
auto_trading_enabled = False

# Track trades per ticker per day for safety rules
# { date_str: { ticker: count } }
daily_trade_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-connect to OpenD on startup."""
    global broker
    try:
        broker = SimulatedBroker(
            initial_cash=INITIAL_CASH,
            commission_per_trade=COMMISSION,
            slippage_bps=SLIPPAGE_BPS,
            opend_host=OPEND_HOST,
            opend_port=OPEND_PORT,
        )
        broker.connect()
        logger.info(f"Broker bridge started — cash: ${broker.get_cash():,.2f}")
    except Exception as e:
        logger.error(f"Could not connect to OpenD on startup: {e}")
        broker = None
    yield
    # Shutdown
    if broker:
        try:
            broker.disconnect()
        except Exception:
            pass


app = FastAPI(
    title="Quant IQ Broker Bridge",
    version="1.0.0",
    description="FastAPI bridge between Quant IQ and Moomoo OpenD",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://betteroption.com.au"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ─────────────────────────────────────────────────

class PlaceOrderRequest(BaseModel):
    symbol:      str   = Field(..., example="US.AAPL")
    side:        str   = Field(..., example="BUY")       # BUY | SELL
    qty:         int   = Field(..., gt=0)
    order_type:  str   = Field("MARKET", example="MARKET")  # MARKET | LIMIT | STOP | STOP_LIMIT
    limit_price: Optional[float] = None
    stop_price:  Optional[float] = None
    notes:       Optional[str]   = None

class BrokerStatus(BaseModel):
    connected:      bool
    mode:           str        # "simulated" | "live"
    auto_trading:   bool
    cash:           Optional[float]
    portfolio_value:Optional[float]
    open_orders:    Optional[int]
    uptime_seconds: Optional[float]
    opend_host:     str
    opend_port:     int

# Track service start time for uptime
_start_time = datetime.now()


# ── Helpers ───────────────────────────────────────────────────────────────────

def require_broker():
    if broker is None or not broker._connected:
        raise HTTPException(status_code=503, detail="Broker not connected. Start OpenD and POST /connect.")

def is_market_open() -> bool:
    """Check if US market is currently open (ET timezone)."""
    et = timezone(timedelta(hours=-5))  # EST (no DST handling — good enough for now)
    now_et = datetime.now(et)
    if now_et.weekday() >= 5:  # Saturday or Sunday
        return False
    t = (now_et.hour, now_et.minute)
    return MARKET_OPEN_ET <= t < MARKET_CLOSE_ET

def today_str() -> str:
    return date.today().isoformat()

def check_safety_rules(symbol: str, side: str, qty: int) -> Optional[str]:
    """
    Check all safety rules before placing an order.
    Returns an error string if blocked, None if allowed.
    """
    # Daily trade limit per ticker
    count = daily_trade_counts[today_str()][symbol]
    if count >= MAX_TRADES_PER_DAY_PER_TICKER:
        return f"Safety: max {MAX_TRADES_PER_DAY_PER_TICKER} trade(s) per day per ticker reached for {symbol}"

    # Market hours check (only for auto-trading — manual overrides allowed)
    if auto_trading_enabled and not is_market_open():
        return "Safety: market is currently closed (auto-trading only)"

    # Position size check for buys
    if side == "BUY" and broker:
        pnl = broker.get_pnl()
        portfolio_value = pnl.get("portfolio_value", 0)
        if portfolio_value > 0:
            # Estimate order value using current ask or last price
            prices = broker._get_live_price(symbol)
            if prices:
                est_price = prices.get("ask") or prices.get("last") or 0
                if est_price > 0:
                    order_pct = (est_price * qty / portfolio_value) * 100
                    if order_pct > MAX_POSITION_PCT:
                        return (
                            f"Safety: order is {order_pct:.1f}% of portfolio "
                            f"(max {MAX_POSITION_PCT}%). Reduce qty."
                        )

    return None  # all checks passed

def format_order(order) -> dict:
    return {
        "order_id":    order.order_id,
        "symbol":      order.symbol,
        "side":        order.side.value,
        "order_type":  order.order_type.value,
        "qty":         order.qty,
        "limit_price": order.limit_price,
        "stop_price":  order.stop_price,
        "status":      order.status.value,
        "fill_price":  order.fill_price,
        "fill_time":   order.fill_time.isoformat() if order.fill_time else None,
        "created_at":  order.created_at.isoformat(),
        "commission":  order.commission,
        "slippage":    order.slippage,
        "notes":       order.notes,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "time": datetime.now().isoformat()}


@app.get("/status", response_model=BrokerStatus)
def get_status():
    connected = broker is not None and broker._connected
    uptime = (datetime.now() - _start_time).total_seconds()

    if connected:
        pnl = broker.get_pnl()
        return BrokerStatus(
            connected=True,
            mode="simulated",
            auto_trading=auto_trading_enabled,
            cash=pnl["cash"],
            portfolio_value=pnl["portfolio_value"],
            open_orders=pnl["open_orders"],
            uptime_seconds=uptime,
            opend_host=OPEND_HOST,
            opend_port=OPEND_PORT,
        )
    return BrokerStatus(
        connected=False,
        mode="simulated",
        auto_trading=auto_trading_enabled,
        cash=None,
        portfolio_value=None,
        open_orders=None,
        uptime_seconds=uptime,
        opend_host=OPEND_HOST,
        opend_port=OPEND_PORT,
    )


@app.post("/connect")
def connect_broker():
    global broker
    try:
        if broker and broker._connected:
            return {"ok": True, "message": "Already connected"}
        if broker:
            broker = None
        broker = SimulatedBroker(
            initial_cash=INITIAL_CASH,
            commission_per_trade=COMMISSION,
            slippage_bps=SLIPPAGE_BPS,
            opend_host=OPEND_HOST,
            opend_port=OPEND_PORT,
        )
        broker.connect()
        return {"ok": True, "message": f"Connected to OpenD at {OPEND_HOST}:{OPEND_PORT}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/disconnect")
def disconnect_broker():
    global broker
    if broker:
        try:
            broker.disconnect()
        except Exception:
            pass
        broker = None
    return {"ok": True}


@app.get("/positions")
def get_positions():
    require_broker()
    return {"positions": broker.get_positions()}


@app.get("/pnl")
def get_pnl():
    require_broker()
    return broker.get_pnl()


@app.get("/orders")
def get_orders(status: Optional[str] = None):
    """
    Get all orders. Optional ?status=PENDING|FILLED|CANCELLED|REJECTED
    """
    require_broker()
    orders = list(broker._orders.values())
    if status:
        orders = [o for o in orders if o.status.value == status.upper()]
    # Most recent first
    orders.sort(key=lambda o: o.created_at, reverse=True)
    return {"orders": [format_order(o) for o in orders]}


@app.get("/orders/open")
def get_open_orders():
    require_broker()
    return {"orders": [format_order(o) for o in broker.get_open_orders()]}


@app.post("/orders")
def place_order(req: PlaceOrderRequest):
    require_broker()

    # Validate enums
    try:
        side       = OrderSide[req.side.upper()]
        order_type = OrderType[req.order_type.upper()]
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Invalid value: {e}")

    # Safety checks
    blocked = check_safety_rules(req.symbol, req.side.upper(), req.qty)
    if blocked:
        raise HTTPException(status_code=422, detail=blocked)

    # Place order
    order_id = broker.place_order(
        symbol      = req.symbol,
        side        = side,
        qty         = req.qty,
        order_type  = order_type,
        limit_price = req.limit_price,
        stop_price  = req.stop_price,
    )

    if order_id is None:
        raise HTTPException(status_code=422, detail="Order rejected — check cash balance or order parameters")

    # Record for daily trade count
    daily_trade_counts[today_str()][req.symbol] += 1

    order = broker.get_order(order_id)
    return {
        "ok":      True,
        "order":   format_order(order),
        "message": f"Order {order_id} placed — status: {order.status.value}",
    }


@app.delete("/orders/{order_id}")
def cancel_order(order_id: str):
    require_broker()
    success = broker.cancel_order(order_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found or already filled")
    return {"ok": True, "message": f"Order {order_id} cancelled"}


@app.get("/orders/{order_id}")
def get_order(order_id: str):
    require_broker()
    order = broker.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
    return format_order(order)


@app.get("/trade-log")
def get_trade_log(limit: int = 50):
    require_broker()
    return {"events": broker.get_trade_log()[:limit]}


# ── Auto-trading control ──────────────────────────────────────────────────────

@app.post("/auto/enable")
def enable_auto_trading():
    global auto_trading_enabled
    auto_trading_enabled = True
    logger.warning("⚡ AUTO-TRADING ENABLED")
    return {"ok": True, "auto_trading": True}

@app.post("/auto/disable")
def disable_auto_trading():
    global auto_trading_enabled
    auto_trading_enabled = False
    logger.info("Auto-trading disabled")
    return {"ok": True, "auto_trading": False}

@app.get("/auto/status")
def auto_trading_status():
    return {
        "auto_trading":        auto_trading_enabled,
        "market_open":         is_market_open(),
        "safety_rules": {
            "max_trades_per_day_per_ticker": MAX_TRADES_PER_DAY_PER_TICKER,
            "max_position_pct":              MAX_POSITION_PCT,
            "market_hours_et":               f"{MARKET_OPEN_ET[0]:02d}:{MARKET_OPEN_ET[1]:02d}–{MARKET_CLOSE_ET[0]:02d}:{MARKET_CLOSE_ET[1]:02d}",
        },
        "daily_trades_today": dict(daily_trade_counts.get(today_str(), {})),
    }

@app.get("/auto/execute-recommendation")
def preview_recommendation(
    symbol:      str,
    side:        str,
    qty:         int,
    order_type:  str   = "MARKET",
    limit_price: Optional[float] = None,
):
    """
    Preview what would happen if this recommendation were executed.
    Returns safety check result and estimated fill details without placing an order.
    Level 1: always preview only.
    Level 2: use POST /orders to actually execute.
    """
    require_broker()

    blocked = check_safety_rules(symbol, side.upper(), qty)
    prices  = broker._get_live_price(symbol) if broker else None
    est_price = None
    if prices:
        est_price = prices.get("ask") if side.upper() == "BUY" else prices.get("bid")

    return {
        "symbol":      symbol,
        "side":        side.upper(),
        "qty":         qty,
        "order_type":  order_type.upper(),
        "limit_price": limit_price,
        "allowed":     blocked is None,
        "blocked_reason": blocked,
        "estimated_fill_price": est_price,
        "estimated_total":      round(est_price * qty, 2) if est_price else None,
        "cash_available":       broker.get_cash() if broker else None,
        "market_open":          is_market_open(),
    }


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════════╗
║         Quant IQ — Broker Bridge Service                 ║
║                                                          ║
║  OpenD:    {OPEND_HOST}:{OPEND_PORT:<44}║
║  Service:  http://localhost:{SERVICE_PORT:<31}║
║  Mode:     Simulated (paper trading)                     ║
║  Docs:     http://localhost:{SERVICE_PORT}/docs                   ║
╚══════════════════════════════════════════════════════════╝
""")
    uvicorn.run(
        "broker_service:app",
        host="127.0.0.1",   # localhost only — never expose to internet
        port=SERVICE_PORT,
        reload=False,
        log_level="info",
    )
