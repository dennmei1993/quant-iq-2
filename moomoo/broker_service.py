"""
broker_service.py
Quant IQ — Broker Bridge Service

Two contexts running in parallel:
  1. SimulatedBroker  — paper trading (place orders, track fills)
  2. TradeContext     — direct OpenD connection (real account read: positions, cash)

Account routing:
  READ_ACCOUNT  = real account  → positions, cash pulled directly via TradeContext
  WRITE_ACCOUNT = sim account   → orders go through SimulatedBroker (dev)
  PROD switch: set WRITE_ACCOUNT = REAL_ACCOUNT to enable live trading

Start:
    pip install fastapi uvicorn moomoo-api
    python broker_service.py
"""

import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, date, timezone, timedelta
from typing import Optional, Dict, List
from collections import defaultdict

import moomoo as ft
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from simulated_broker import SimulatedBroker, OrderSide, OrderType, OrderStatus

# ── Config ────────────────────────────────────────────────────────────────────

OPEND_HOST   = os.getenv("OPEND_HOST",   "127.0.0.1")
OPEND_PORT   = int(os.getenv("OPEND_PORT", "11111"))
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8765"))
INITIAL_CASH = float(os.getenv("INITIAL_CASH", "100000"))
COMMISSION   = float(os.getenv("COMMISSION",   "0.0"))
SLIPPAGE_BPS = float(os.getenv("SLIPPAGE_BPS", "2.0"))

# Safety rules
MAX_TRADES_PER_DAY_PER_TICKER = int(os.getenv("MAX_DAILY_TRADES",  "1"))
MAX_POSITION_PCT               = float(os.getenv("MAX_POSITION_PCT", "5.0"))
MARKET_OPEN_ET                 = (9, 30)
MARKET_CLOSE_ET                = (16, 0)

# ── Account routing ───────────────────────────────────────────────────────────
#
#   DEV:  READ_ACCOUNT  = real account  (positions, cash from OpenD)
#         WRITE_ACCOUNT = sim  account  (paper orders — no real money)
#
#   PROD: set WRITE_ACCOUNT = READ_ACCOUNT to go live
#
READ_ACCOUNT  = os.getenv("READ_ACCOUNT",  "")
WRITE_ACCOUNT = os.getenv("WRITE_ACCOUNT", "")
IS_PROD       = bool(READ_ACCOUNT and WRITE_ACCOUNT and READ_ACCOUNT == WRITE_ACCOUNT)
TRADE_PWD     = os.getenv("TRADE_PWD", "")       # 6-digit trade PIN for real account
TRADE_FIRM    = os.getenv("TRADE_FIRM",    "FUTUAU")   # confirmed firm for AU accounts
# NOTE: 151859091 = Moomoo login/user ID (used for OpenD login)
#       284008278648769324 = trading account ID (used for API order placement)
REAL_ACC_ID   = os.getenv("REAL_ACC_ID",  "284008278648769324")  # trading account ID

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

broker:      Optional[SimulatedBroker]          = None
trd_ctx:     Optional[ft.OpenSecTradeContext]   = None
trd_acc_id:  Optional[int]                      = None   # resolved trade account id
trd_env:     Optional[ft.TrdEnv]                = None   # REAL or SIMULATE
auto_trading_enabled = False
daily_trade_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
_start_time = datetime.now()


# ── Trade context helpers ─────────────────────────────────────────────────────

def open_trade_context() -> Optional[ft.OpenSecTradeContext]:
    """Open a fresh TradeContext — tries all security firms."""
    # FUTUAU first — confirmed correct firm for AU accounts
    firms = [n for n in ['FUTUAU','FUTUSECURITIES','FUTUINC','FUTUHK','FUTUSG']
             if hasattr(ft.SecurityFirm, n)]
    for firm_name in firms:
        firm = getattr(ft.SecurityFirm, firm_name)
        try:
            ctx = ft.OpenSecTradeContext(host=OPEND_HOST, port=OPEND_PORT, security_firm=firm)
            ret, data = ctx.get_acc_list()
            if ret == ft.RET_OK and len(data) > 0:
                logger.info(f"TradeContext opened with firm={firm_name}, accounts={len(data)}")
                logger.info(f"Account list:\n{data.to_string()}")
                return ctx
            ctx.close()
        except Exception as e:
            logger.debug(f"firm={firm_name} failed: {e}")
    logger.warning("Could not open TradeContext with any firm")
    return None


def resolve_account(ctx: ft.OpenSecTradeContext, requested_id: str = ""):
    """
    Resolve account id + env from the trade context.
    Returns (acc_id, trd_env) or (None, None).
    Prefers REAL env. Falls back to first available.
    """
    ret, data = ctx.get_acc_list()
    if ret != ft.RET_OK or len(data) == 0:
        return None, None

    logger.info(f"resolve_account: {[(str(r['acc_id']), str(r['trd_env'])) for _, r in data.iterrows()]}")

    # Exact match first
    if requested_id:
        for _, row in data.iterrows():
            if str(row['acc_id']) == str(requested_id):
                return row['acc_id'], row['trd_env']

    # Prefer REAL env
    for _, row in data.iterrows():
        if str(row.get('trd_env', '')) == 'REAL':
            logger.info(f"Using REAL account: {row['acc_id']}")
            return row['acc_id'], row['trd_env']

    # Fallback: first account
    row = data.iloc[0]
    logger.info(f"Using first account: {row['acc_id']} ({row['trd_env']})")
    return row['acc_id'], row['trd_env']


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global broker, trd_ctx, trd_acc_id, trd_env

    # 1. SimulatedBroker (paper trading)
    try:
        broker = SimulatedBroker(
            initial_cash=INITIAL_CASH,
            commission_per_trade=COMMISSION,
            slippage_bps=SLIPPAGE_BPS,
            opend_host=OPEND_HOST,
            opend_port=OPEND_PORT,
        )
        broker.connect()
        logger.info(f"SimulatedBroker ready — cash: ${broker.get_cash():,.2f}")
    except Exception as e:
        logger.error(f"SimulatedBroker failed: {e}")
        broker = None

    # 2. Direct TradeContext for real account reads
    try:
        trd_ctx = open_trade_context()
        if trd_ctx:
            trd_acc_id, trd_env = resolve_account(trd_ctx, READ_ACCOUNT)
            logger.info(f"TradeContext ready — acc={trd_acc_id} env={trd_env}")
        else:
            logger.warning("TradeContext unavailable — account reads will fail")
    except Exception as e:
        logger.error(f"TradeContext failed: {e}")
        trd_ctx = None

    # Auto-unlock on startup if TRADE_PWD is set
    if TRADE_PWD:
        try:
            ul_ctx = ft.OpenSecTradeContext(
                host=OPEND_HOST, port=OPEND_PORT,
                security_firm=ft.SecurityFirm.FUTUAU,
            )
            ret, msg = ul_ctx.unlock_trade(TRADE_PWD)
            if ret == ft.RET_OK:
                logger.info("Auto-unlock: OK")
            else:
                logger.warning(f"Auto-unlock failed: {msg}")
            ul_ctx.close()
        except Exception as e:
            logger.warning(f"Auto-unlock error: {e}")

    logger.info(f"READ_ACCOUNT={READ_ACCOUNT or 'auto'} | WRITE_ACCOUNT={WRITE_ACCOUNT or 'auto'} | IS_PROD={IS_PROD}")
    yield

    if broker:
        try: broker.disconnect()
        except: pass
    if trd_ctx:
        try: trd_ctx.close()
        except: pass


app = FastAPI(title="Quant IQ Broker Bridge", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://betteroption.com.au"],
    allow_methods=["*"], allow_headers=["*"])


# ── Models ────────────────────────────────────────────────────────────────────

class PlaceOrderRequest(BaseModel):
    symbol:      str
    side:        str
    qty:         int = Field(..., gt=0)
    order_type:  str = "MARKET"
    limit_price: Optional[float] = None
    stop_price:  Optional[float] = None
    notes:       Optional[str]   = None
    trade_pwd:   Optional[str]   = None   # trade PIN for real account unlock

class BrokerStatus(BaseModel):
    connected:        bool
    mode:             str
    auto_trading:     bool
    cash:             Optional[float]
    portfolio_value:  Optional[float]
    open_orders:      Optional[int]
    uptime_seconds:   Optional[float]
    opend_host:       str
    opend_port:       int
    read_account:     Optional[str]
    write_account:    Optional[str]
    trade_ctx_ready:  bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def require_broker():
    if not broker or not broker._connected:
        raise HTTPException(503, "SimulatedBroker not connected")

def require_trd():
    if not trd_ctx:
        raise HTTPException(503, "TradeContext not available — check OpenD")

def is_market_open() -> bool:
    et  = timezone(timedelta(hours=-5))
    now = datetime.now(et)
    if now.weekday() >= 5: return False
    return MARKET_OPEN_ET <= (now.hour, now.minute) < MARKET_CLOSE_ET

def today_str() -> str:
    return date.today().isoformat()

def check_safety(symbol: str, side: str, qty: int) -> Optional[str]:
    if daily_trade_counts[today_str()][symbol] >= MAX_TRADES_PER_DAY_PER_TICKER:
        return f"Safety: max {MAX_TRADES_PER_DAY_PER_TICKER} trade/day reached for {symbol}"
    if auto_trading_enabled and not is_market_open():
        return "Safety: market closed (auto-trading)"
    if side == "BUY" and broker:
        pnl = broker.get_pnl()
        pv  = pnl.get("portfolio_value", 0)
        prices = broker._get_live_price(symbol) if broker else None
        if pv > 0 and prices:
            est = prices.get("ask") or prices.get("last") or 0
            if est > 0 and (est * qty / pv * 100) > MAX_POSITION_PCT:
                return f"Safety: order exceeds {MAX_POSITION_PCT}% position limit"
    return None

def fmt_order(o) -> dict:
    return {
        "order_id":   o.order_id, "symbol": o.symbol,
        "side":       o.side.value, "order_type": o.order_type.value,
        "qty":        o.qty, "limit_price": o.limit_price, "stop_price": o.stop_price,
        "status":     o.status.value, "fill_price": o.fill_price,
        "fill_time":  o.fill_time.isoformat() if o.fill_time else None,
        "created_at": o.created_at.isoformat(),
        "commission": o.commission, "slippage": o.slippage, "notes": o.notes,
    }


# ── Core endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "time": datetime.now().isoformat()}


@app.get("/status", response_model=BrokerStatus)
def get_status():
    uptime    = (datetime.now() - _start_time).total_seconds()
    connected = broker is not None and broker._connected
    pnl       = broker.get_pnl() if connected else {}
    return BrokerStatus(
        connected=connected,
        mode="live" if IS_PROD else "simulated",
        auto_trading=auto_trading_enabled,
        cash=pnl.get("cash"),
        portfolio_value=pnl.get("portfolio_value"),
        open_orders=pnl.get("open_orders"),
        uptime_seconds=uptime,
        opend_host=OPEND_HOST,
        opend_port=OPEND_PORT,
        read_account=str(trd_acc_id) if trd_acc_id else READ_ACCOUNT or None,
        write_account=WRITE_ACCOUNT or None,
        trade_ctx_ready=trd_ctx is not None,
    )


@app.get("/account/config")
def account_config():
    return {
        "read_account":   str(trd_acc_id) if trd_acc_id else READ_ACCOUNT or "auto",
        "write_account":  WRITE_ACCOUNT or "auto (simulate)",
        "trade_env":      str(trd_env) if trd_env else "unknown",
        "mode":           "production (LIVE)" if IS_PROD else "development (paper)",
        "trade_ctx_ready": trd_ctx is not None,
    }


@app.get("/account/list")
def list_accounts():
    """List all accounts visible to TradeContext."""
    ctx = open_trade_context()
    if not ctx:
        raise HTTPException(503, "Cannot open TradeContext")
    try:
        ret, data = ctx.get_acc_list()
        if ret != ft.RET_OK:
            raise HTTPException(500, str(data))
        accounts = [
            {k: str(v) for k, v in row.items()}
            for _, row in data.iterrows()
        ]
        return {"accounts": accounts, "count": len(accounts)}
    finally:
        ctx.close()


@app.get("/account/positions")
def get_positions_real(env: str = "read"):
    """
    Pull positions directly from OpenD TradeContext.
    env=read    → uses resolved trd_acc_id (real account in dev)
    env=simulate → queries with SIMULATE trd_env
    """
    require_trd()
    try:
        use_env  = trd_env  # use whatever was resolved at startup
        use_acc  = trd_acc_id

        ret, pos_data = trd_ctx.position_list_query(trd_env=use_env, acc_id=use_acc)
        if ret != ft.RET_OK:
            raise HTTPException(500, f"position_list_query failed: {pos_data}")

        logger.info(f"Positions columns: {list(pos_data.columns)}")
        logger.info(f"Positions data:\n{pos_data.to_string()}")

        positions = []
        for _, row in pos_data.iterrows():
            code   = str(row.get("code", ""))
            ticker = code.split(".")[-1] if "." in code else code
            qty    = int(float(row.get("qty", 0)))
            if qty == 0:
                continue
            cost    = float(row.get("cost_price",    0) or 0)
            mkt_val = float(row.get("market_val",    0) or 0)
            unreal  = float(row.get("unrealised_pl", 0) or 0)
            price   = mkt_val / qty if qty else 0
            positions.append({
                "symbol":          f"US.{ticker}",
                "ticker":          ticker,
                "qty":             qty,
                "avg_cost":        round(cost,   4),
                "market_price":    round(price,  4),
                "market_value":    round(mkt_val, 2),
                "cost_basis":      round(cost * qty, 2),
                "unrealised_pnl":  round(unreal, 2),
                "unrealised_pnl%": round(unreal / (cost * qty) * 100 if cost * qty else 0, 2),
            })

        # Cash / account summary
        ret2, funds = trd_ctx.accinfo_query(trd_env=use_env, acc_id=use_acc)
        cash = total_value = None
        if ret2 == ft.RET_OK and len(funds) > 0:
            logger.info(f"accinfo columns: {list(funds.columns)}")
            logger.info(f"accinfo data:\n{funds.to_string()}")
            cash        = round(float(funds.iloc[0].get("cash",         0) or 0), 2)
            total_value = round(float(funds.iloc[0].get("total_assets", 0) or 0), 2)

        return {
            "account":     str(use_acc),
            "trd_env":     str(use_env),
            "positions":   positions,
            "cash":        cash,
            "total_value": total_value,
            "count":       len(positions),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Moomoo real account order endpoints ──────────────────────────────────────────

@app.post("/orders/moomoo")
def place_order_moomoo(req: PlaceOrderRequest):
    """Place order directly in Moomoo account via TradeContext."""
    require_trd()

    # Use confirmed FUTUAU firm — shows real account 284008278648769324
    us_ctx = None
    us_acc_id = None
    us_env = None
    try:
        us_ctx = ft.OpenSecTradeContext(
            host=OPEND_HOST, port=OPEND_PORT,
            security_firm=ft.SecurityFirm.FUTUAU,
        )
        ret, data = us_ctx.get_acc_list()
        if ret == ft.RET_OK and len(data) > 0:
            # Prefer REAL account
            for _, row in data.iterrows():
                if str(row.get('trd_env','')) == 'REAL':
                    us_acc_id = row['acc_id']
                    us_env    = row['trd_env']
                    break
            if us_acc_id is None:
                us_acc_id = data.iloc[0]['acc_id']
                us_env    = data.iloc[0]['trd_env']
            logger.info(f"Using account {us_acc_id} ({us_env})")
    except Exception as e:
        raise HTTPException(503, f"Cannot open trade context: {e}")

    if not us_ctx or us_acc_id is None:
        raise HTTPException(503, "No trading account found.")

    try:
        # Unlock trade
        trade_pwd = req.trade_pwd or TRADE_PWD
        if trade_pwd:
            ret_u, msg_u = us_ctx.unlock_trade(trade_pwd)
            if ret_u != ft.RET_OK:
                logger.warning(f"Unlock failed: {msg_u}")
            else:
                logger.info("Trade unlocked")

        side       = ft.TrdSide.BUY if req.side.upper() == "BUY" else ft.TrdSide.SELL
        order_type = ft.OrderType.MARKET if req.order_type.upper() == "MARKET" else ft.OrderType.NORMAL

        price = req.limit_price or 0.0
        if price == 0.0:
            prices = broker._get_live_price(req.symbol) if broker else None
            if prices:
                price = prices.get("ask") if req.side.upper() == "BUY" else prices.get("bid")
                price = round(float(price) * 1.005, 2)
            if not price:
                raise HTTPException(400, "Cannot determine price — provide limit_price")

        ret, data = us_ctx.place_order(
            price=price, qty=req.qty, code=req.symbol,
            trd_side=side, order_type=order_type,
            trd_env=us_env, acc_id=us_acc_id,
        )

        if ret != ft.RET_OK:
            raise HTTPException(422, f"Moomoo order failed: {data}")

        order_id = str(data.iloc[0].get("order_id", "")) if hasattr(data, "iloc") else str(data)
        logger.info(f"Moomoo order placed: {order_id} {req.side} {req.qty} {req.symbol} @ {price}")
        return {
            "ok":      True,
            "order_id": order_id,
            "symbol":  req.symbol,
            "side":    req.side.upper(),
            "qty":     req.qty,
            "price":   price,
            "account": str(us_acc_id),
            "trd_env": str(us_env),
            "message": f"Order sent to Moomoo {us_env} account {us_acc_id}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if us_ctx:
            try: us_ctx.close()
            except: pass





@app.delete("/orders/moomoo/{order_id}")
def cancel_order_moomoo(order_id: str):
    """Cancel a pending order in the real Moomoo account."""
    ctx = None
    try:
        ctx = ft.OpenSecTradeContext(
            host=OPEND_HOST, port=OPEND_PORT,
            security_firm=ft.SecurityFirm.FUTUAU,
        )
        # Resolve account
        ret_l, data_l = ctx.get_acc_list()
        acc_id = None
        env    = None
        if ret_l == ft.RET_OK:
            for _, row in data_l.iterrows():
                if str(row.get('trd_env','')) == 'REAL':
                    acc_id = row['acc_id']
                    env    = row['trd_env']
                    break
            if acc_id is None and len(data_l) > 0:
                acc_id = data_l.iloc[0]['acc_id']
                env    = data_l.iloc[0]['trd_env']

        if acc_id is None:
            raise HTTPException(503, "No account found")

        # Must unlock on this context instance before modifying orders
        if TRADE_PWD:
            ret_u, msg_u = ctx.unlock_trade(TRADE_PWD)
            if ret_u != ft.RET_OK:
                logger.warning(f"Unlock in cancel: {msg_u}")
            else:
                logger.info("Unlocked for cancel")

        ret, data = ctx.modify_order(
            modify_order_op=ft.ModifyOrderOp.CANCEL,
            order_id=order_id,
            qty=0, price=0,
            trd_env=env,
            acc_id=acc_id,
        )
        if ret != ft.RET_OK:
            raise HTTPException(422, f"Cancel failed: {data}")

        logger.info(f"Cancelled Moomoo order {order_id}")
        return {"ok": True, "order_id": order_id, "message": "Order cancelled"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if ctx:
            try: ctx.close()
            except: pass



@app.get("/orders/moomoo")
def get_orders_moomoo(status: str = ""):
    """Get orders from Moomoo account directly (not SimulatedBroker)."""
    require_trd()
    try:
        filter_status = ft.OrderStatus.NONE
        ret, data = trd_ctx.order_list_query(trd_env=trd_env, acc_id=trd_acc_id)
        if ret != ft.RET_OK:
            raise HTTPException(500, f"order_list_query failed: {data}")

        orders = []
        for _, row in data.iterrows():
            orders.append({k: str(v) for k, v in row.items()})
        return {"orders": orders, "account": str(trd_acc_id), "trd_env": str(trd_env)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Auto-trading ──────────────────────────────────────────────────────────────



# ── SimulatedBroker endpoints (paper trading / write) ─────────────────────────

@app.get("/positions")
def get_sim_positions():
    """Simulated positions (paper trading)."""
    require_broker()
    return {"positions": broker.get_positions()}

@app.get("/pnl")
def get_pnl():
    require_broker()
    return broker.get_pnl()

@app.get("/orders")
def get_orders(status: Optional[str] = None):
    require_broker()
    orders = list(broker._orders.values())
    if status:
        orders = [o for o in orders if o.status.value == status.upper()]
    orders.sort(key=lambda o: o.created_at, reverse=True)
    return {"orders": [fmt_order(o) for o in orders]}

@app.get("/orders/open")
def get_open_orders():
    require_broker()
    return {"orders": [fmt_order(o) for o in broker.get_open_orders()]}

@app.post("/orders")
def place_order(req: PlaceOrderRequest):
    """Place paper order via SimulatedBroker (WRITE_ACCOUNT = simulate in dev)."""
    require_broker()
    try:
        side       = OrderSide[req.side.upper()]
        order_type = OrderType[req.order_type.upper()]
    except KeyError as e:
        raise HTTPException(400, f"Invalid value: {e}")

    blocked = check_safety(req.symbol, req.side.upper(), req.qty)
    if blocked:
        raise HTTPException(422, blocked)

    order_id = broker.place_order(
        symbol=req.symbol, side=side, qty=req.qty,
        order_type=order_type,
        limit_price=req.limit_price, stop_price=req.stop_price,
    )
    if order_id is None:
        raise HTTPException(422, "Order rejected — insufficient cash or invalid params")

    daily_trade_counts[today_str()][req.symbol] += 1
    order = broker.get_order(order_id)
    return {"ok": True, "order": fmt_order(order)}

@app.delete("/orders/{order_id}")
def cancel_order(order_id: str):
    require_broker()
    if not broker.cancel_order(order_id):
        raise HTTPException(404, f"Order {order_id} not found or already filled")
    return {"ok": True}

@app.get("/orders/{order_id}")
def get_order(order_id: str):
    require_broker()
    order = broker.get_order(order_id)
    if not order:
        raise HTTPException(404, f"Order {order_id} not found")
    return fmt_order(order)

@app.get("/trade-log")
def get_trade_log(limit: int = 50):
    require_broker()
    return {"events": broker.get_trade_log()[:limit]}



@app.post("/account/unlock")
def unlock_trade(pwd: str):
    """Unlock trade using FUTUAU firm (confirmed for AU accounts)."""
    global TRADE_PWD
    ctx = None
    try:
        ctx = ft.OpenSecTradeContext(
            host=OPEND_HOST, port=OPEND_PORT,
            security_firm=ft.SecurityFirm.FUTUAU,
        )
        ret, msg = ctx.unlock_trade(pwd)
        if ret == ft.RET_OK:
            TRADE_PWD = pwd  # store for subsequent calls
            logger.info("Trade unlocked (FUTUAU)")
            return {"ok": True, "message": "Trade unlocked"}
        raise HTTPException(401, f"Wrong trade PIN: {msg}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if ctx:
            try: ctx.close()
            except: pass



def place_order_moomoo(req: PlaceOrderRequest):
    """
    Place order directly in Moomoo account via TradeContext.
    In dev: sends to simulate account (Moomoo paper account).
    In prod: sends to real account when REAL env account is available.
    This is what actually appears in the Moomoo app.
    """
    require_trd()

    # Open a fresh context filtered for US market
    us_ctx = None
    us_acc_id = None
    us_env = None

    for firm_name in ['FUTUSECURITIES', 'FUTUINC', 'FUTUAU', 'FUTUHK', 'FUTUSG']:
        if not hasattr(ft.SecurityFirm, firm_name):
            continue
        try:
            ctx = ft.OpenSecTradeContext(
                filter_trdmarket=ft.TrdMarket.US,
                host=OPEND_HOST, port=OPEND_PORT,
                security_firm=getattr(ft.SecurityFirm, firm_name),
            )
            ret, data = ctx.get_acc_list()
            if ret == ft.RET_OK and len(data) > 0:
                logger.info(f"US trade context found with {firm_name}: {data.to_string()}")
                us_ctx    = ctx
                us_acc_id = data.iloc[0]['acc_id']
                us_env    = data.iloc[0]['trd_env']
                break
            ctx.close()
        except Exception as e:
            logger.debug(f"{firm_name} US ctx failed: {e}")
            continue

    if not us_ctx:
        raise HTTPException(503, "No US trading account found in OpenD.")

    try:
        # Unlock trade for real account
        trade_pwd = req.trade_pwd or TRADE_PWD
        if trade_pwd:
            ret_u, msg_u = us_ctx.unlock_trade(trade_pwd)
            if ret_u != ft.RET_OK:
                logger.warning(f"Trade unlock failed: {msg_u}")
            else:
                logger.info("Trade unlocked")
        side = ft.TrdSide.BUY if req.side.upper() == "BUY" else ft.TrdSide.SELL
        order_type = ft.OrderType.MARKET if req.order_type.upper() == "MARKET" else ft.OrderType.NORMAL

        price = req.limit_price or 0.0
        if price == 0.0:
            prices = broker._get_live_price(req.symbol) if broker else None
            if prices:
                price = prices.get("ask") if req.side.upper() == "BUY" else prices.get("bid")
                price = round(price * 1.005, 2)
            if not price:
                raise HTTPException(400, "Cannot determine price — provide limit_price")

        ret, data = us_ctx.place_order(
            price=price, qty=req.qty, code=req.symbol,
            trd_side=side, order_type=order_type,
            trd_env=us_env, acc_id=us_acc_id,
        )

        if ret != ft.RET_OK:
            raise HTTPException(422, f"Moomoo order failed: {data}")

        order_id = str(data.iloc[0].get("order_id", "")) if hasattr(data, "iloc") else str(data)
        return {
            "ok":      True,
            "order_id": order_id,
            "symbol":  req.symbol,
            "side":    req.side.upper(),
            "qty":     req.qty,
            "price":   price,
            "account": str(us_acc_id),
            "trd_env": str(us_env),
            "message": f"Order sent to Moomoo account {us_acc_id} ({us_env})",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if us_ctx:
            try: us_ctx.close()
            except: pass


@app.post("/auto/enable")
def enable_auto():
    global auto_trading_enabled
    auto_trading_enabled = True
    return {"ok": True, "auto_trading": True}

@app.post("/auto/disable")
def disable_auto():
    global auto_trading_enabled
    auto_trading_enabled = False
    return {"ok": True, "auto_trading": False}

@app.get("/auto/status")
def auto_status():
    return {
        "auto_trading": auto_trading_enabled,
        "market_open":  is_market_open(),
        "safety_rules": {
            "max_trades_per_day": MAX_TRADES_PER_DAY_PER_TICKER,
            "max_position_pct":   MAX_POSITION_PCT,
        },
        "daily_trades": dict(daily_trade_counts.get(today_str(), {})),
    }

@app.get("/auto/execute-recommendation")
def preview_recommendation(
    symbol: str, side: str, qty: int,
    order_type: str = "MARKET", limit_price: Optional[float] = None,
):
    require_broker()
    blocked = check_safety(symbol, side.upper(), qty)
    prices  = broker._get_live_price(symbol)
    est     = None
    if prices:
        est = prices.get("ask") if side.upper() == "BUY" else prices.get("bid")
    return {
        "symbol": symbol, "side": side.upper(), "qty": qty,
        "order_type": order_type.upper(), "limit_price": limit_price,
        "allowed": blocked is None, "blocked_reason": blocked,
        "estimated_fill_price": est,
        "estimated_total": round(est * qty, 2) if est else None,
        "cash_available": broker.get_cash(),
        "market_open": is_market_open(),
    }


@app.post("/connect")
def connect():
    global broker
    try:
        if broker and broker._connected:
            return {"ok": True, "message": "Already connected"}
        broker = SimulatedBroker(
            initial_cash=INITIAL_CASH, commission_per_trade=COMMISSION,
            slippage_bps=SLIPPAGE_BPS, opend_host=OPEND_HOST, opend_port=OPEND_PORT,
        )
        broker.connect()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/disconnect")
def disconnect():
    global broker
    if broker:
        try: broker.disconnect()
        except: pass
        broker = None
    return {"ok": True}


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════════╗
║         Quant IQ — Broker Bridge v2                      ║
║                                                          ║
║  OpenD:    {OPEND_HOST}:{OPEND_PORT:<44}║
║  Service:  http://localhost:{SERVICE_PORT:<31}║
║  Docs:     http://localhost:{SERVICE_PORT}/docs                   ║
║                                                          ║
║  READ  → real account positions (via TradeContext)       ║
║  WRITE → simulate account orders (via SimulatedBroker)   ║
╚══════════════════════════════════════════════════════════╝
""")
    uvicorn.run("broker_service:app", host="127.0.0.1", port=SERVICE_PORT, reload=False)
