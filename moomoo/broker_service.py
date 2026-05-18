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

# ── Safe numeric helpers ──────────────────────────────────────────────────────

import math as _math

def safe_f(v, d: float = 0.0) -> float:
    """Convert value to float, returning d for NaN/Inf/None/errors."""
    try:
        f = float(v)
        return d if _math.isnan(f) or _math.isinf(f) else f
    except (TypeError, ValueError):
        return d

def safe_i(v, d: int = 0) -> int:
    """Convert value to int, returning d for NaN/Inf/None/errors."""
    return int(safe_f(v, float(d)))



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

    # Trade PIN is now injected per-request from user profile via Next.js proxy
    # No auto-unlock needed on startup
    logger.info("Trade PIN: injected per-request from user profile")

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
    symbol:       str
    side:         str
    qty:          int = Field(..., gt=0)
    order_type:   str = "MARKET"
    limit_price:  Optional[float] = None
    stop_price:   Optional[float] = None
    notes:        Optional[str]   = None
    trade_pwd:    Optional[str]   = None   # trade PIN — injected by Next.js proxy from profile
    account_id:   Optional[str]   = None   # trade account — injected by proxy (paper or live)
    trading_mode: Optional[str]   = None   # 'paper' or 'live' — injected by proxy

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
    """Pull positions from real Moomoo account via FUTUAU."""
    ctx = None
    try:
        ctx = ft.OpenSecTradeContext(
            host=OPEND_HOST, port=OPEND_PORT,
            security_firm=ft.SecurityFirm.FUTUAU,
        )
        ret, acc_data = ctx.get_acc_list()
        if ret != ft.RET_OK or len(acc_data) == 0:
            raise HTTPException(500, f"Cannot get account list: {acc_data}")

        # Prefer REAL account
        use_acc = None
        use_env = None
        for _, row in acc_data.iterrows():
            if str(row.get('trd_env', '')) == 'REAL':
                use_acc = row['acc_id']
                use_env = row['trd_env']
                break
        if use_acc is None:
            use_acc = acc_data.iloc[0]['acc_id']
            use_env = acc_data.iloc[0]['trd_env']

        logger.info(f"Querying positions for account {use_acc} ({use_env})")

        ret, pos_data = ctx.position_list_query(trd_env=use_env, acc_id=use_acc)
        if ret != ft.RET_OK:
            raise HTTPException(500, f"position_list_query failed: {pos_data}")

        logger.info(f"Positions columns: {list(pos_data.columns)}")

        positions = []
        for _, row in pos_data.iterrows():
            code   = str(row.get("code", ""))
            ticker = code.split(".")[-1] if "." in code else code
            qty    = int(float(row.get("qty", 0)))
            if qty == 0:
                continue
            cost    = float(row.get("cost_price",    0) or 0)
            mkt_val = float(row.get("market_val",    0) or 0)
            price   = float(row.get("nominal_price", 0) or 0) or (mkt_val / qty if qty else 0)
            unreal  = float(row.get("unrealized_pl", 0) or 0)
            real    = float(row.get("realized_pl",   0) or 0)
            logger.debug(f"Position {ticker}: cost={cost} mkt_val={mkt_val} unreal={unreal} real={real} row_keys={list(row.index)}")
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
                "realised_pnl":    round(real,   2),
            })

        # Cash / account summary
        ret2, funds = ctx.accinfo_query(trd_env=use_env, acc_id=use_acc)
        cash = total_value = None
        if ret2 == ft.RET_OK and len(funds) > 0:
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
    finally:
        if ctx:
            try: ctx.close()
            except: pass


# ── Moomoo real account order endpoints ──────────────────────────────────────────

@app.post("/orders/moomoo")
def place_order_moomoo(req: PlaceOrderRequest):
    """Place order directly in Moomoo account via TradeContext."""
    require_trd()

    # Use account_id from request (injected by proxy from user profile)
    # trading_mode='paper' → use simulate account; 'live' → use real account
    requested_account = req.account_id or ""
    trading_mode      = req.trading_mode or "paper"

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
            logger.info(f"Available accounts: {[(str(r['acc_id']), str(r['trd_env'])) for _, r in data.iterrows()]}")

            # Match requested account ID first
            if requested_account:
                for _, row in data.iterrows():
                    if str(row.get('acc_id', '')) == str(requested_account):
                        us_acc_id = row['acc_id']
                        us_env    = row['trd_env']
                        break

            # Fall back based on trading mode
            if us_acc_id is None:
                if trading_mode == 'live':
                    # Prefer REAL account for live trading
                    for _, row in data.iterrows():
                        if str(row.get('trd_env', '')) == 'REAL':
                            us_acc_id = row['acc_id']
                            us_env    = row['trd_env']
                            break
                else:
                    # Prefer SIMULATE account for paper trading
                    # Use US market filter to get US simulate account (327518)
                    try:
                        us_ctx2 = ft.OpenSecTradeContext(
                            filter_trdmarket=ft.TrdMarket.US,
                            host=OPEND_HOST, port=OPEND_PORT,
                            security_firm=ft.SecurityFirm.FUTUAU,
                        )
                        ret2, data2 = us_ctx2.get_acc_list()
                        if ret2 == ft.RET_OK and len(data2) > 0:
                            for _, row in data2.iterrows():
                                if str(row.get('trd_env', '')) == 'SIMULATE':
                                    us_acc_id = row['acc_id']
                                    us_env    = row['trd_env']
                                    # Switch context to US-filtered one
                                    us_ctx.close()
                                    us_ctx = us_ctx2
                                    break
                        if us_acc_id is None:
                            us_ctx2.close()
                    except Exception as e:
                        logger.warning(f"US simulate account lookup failed: {e}")

            # Final fallback
            if us_acc_id is None:
                us_acc_id = data.iloc[0]['acc_id']
                us_env    = data.iloc[0]['trd_env']

            logger.info(f"Using account {us_acc_id} ({us_env}) for {trading_mode} trading")
    except Exception as e:
        raise HTTPException(503, f"Cannot open trade context: {e}")

    if not us_ctx or us_acc_id is None:
        raise HTTPException(503, "No trading account found.")

    try:
        # Unlock trade — required for every new TradeContext instance
        trade_pwd = req.trade_pwd or TRADE_PWD
        if not trade_pwd:
            raise HTTPException(401, "Trade PIN not configured. Set TRADE_PWD env var in broker-start.ps1 or pass trade_pwd in request.")

        ret_u, msg_u = us_ctx.unlock_trade(trade_pwd)
        if ret_u != ft.RET_OK:
            raise HTTPException(401, f"Trade unlock failed: {msg_u}. Check your trade PIN in broker-start.ps1 (TRADE_PWD).")
        logger.info("Trade unlocked for order placement")

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
def cancel_order_moomoo(order_id: str, trade_pwd: str = ""):
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
        pwd = trade_pwd or TRADE_PWD
        if not pwd:
            raise HTTPException(401, "Trade PIN not configured")
        ret_u, msg_u = ctx.unlock_trade(pwd)
        if ret_u != ft.RET_OK:
            raise HTTPException(401, f"Trade unlock failed: {msg_u}")

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
    """Get orders from both real and simulate Moomoo accounts via FUTUAU."""
    all_orders = []

    # Query both no-filter (gets real + HK sim) and US-filter (gets US sim 327518)
    contexts_to_try = [
        {"filter": None,          "label": "no-filter"},
        {"filter": ft.TrdMarket.US, "label": "US-filter"},
    ]

    seen_accounts = set()

    for ctx_config in contexts_to_try:
        ctx = None
        try:
            kwargs = dict(host=OPEND_HOST, port=OPEND_PORT, security_firm=ft.SecurityFirm.FUTUAU)
            if ctx_config["filter"]:
                kwargs["filter_trdmarket"] = ctx_config["filter"]
            ctx = ft.OpenSecTradeContext(**kwargs)

            ret, acc_data = ctx.get_acc_list()
            if ret != ft.RET_OK or len(acc_data) == 0:
                continue

            for _, acc_row in acc_data.iterrows():
                acc_id  = acc_row['acc_id']
                acc_env = acc_row['trd_env']
                acc_key = f"{acc_id}_{acc_env}"

                if acc_key in seen_accounts:
                    continue
                seen_accounts.add(acc_key)

                ret2, order_data = ctx.order_list_query(trd_env=acc_env, acc_id=acc_id)
                if ret2 != ft.RET_OK or len(order_data) == 0:
                    continue

                logger.info(f"Account {acc_id} ({acc_env}): {len(order_data)} orders")
                if len(order_data) > 0:
                    logger.info(f"Order columns: {list(order_data.columns)}")

                for _, row in order_data.iterrows():
                    order = {k: str(v) for k, v in row.items()}
                    order['_account_id']  = str(acc_id)
                    order['_trd_env']     = str(acc_env)
                    all_orders.append(order)

        except Exception as e:
            logger.warning(f"Order query failed for {ctx_config['label']}: {e}")
        finally:
            if ctx:
                try: ctx.close()
                except: pass

    return {"orders": all_orders, "count": len(all_orders)}

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


# ── Options endpoints ─────────────────────────────────────────────────────────

@app.get("/options/expiries")
def get_option_expiries(symbol: str):
    """
    GET /options/expiries?symbol=US.GOOG
    Returns available option expiry dates for a symbol.
    Requires OpenD with US Options LV1 subscription.
    """
    try:
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        ret, data = ctx.get_option_expiration_date(symbol)
        ctx.close()
        if ret != ft.RET_OK:
            raise HTTPException(500, f"get_option_expiration_date failed: {data}")
        dates = data['strike_time'].tolist() if 'strike_time' in data.columns else []
        return {"symbol": symbol, "expiries": dates}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/options/chain")
def get_option_chain(symbol: str, expiry: str, strike_count: int = 10):
    """
    GET /options/chain?symbol=US.GOOG&expiry=2025-06-20&strike_count=10
    Returns call and put option chain for a symbol + expiry.
    Each row: strike, call_bid, call_ask, call_iv, call_delta, call_volume,
              put_bid,  put_ask,  put_iv,  put_delta,  put_volume, is_atm
    """
    try:
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)

        # Get option chain (calls and puts)
        ret, data = ctx.get_option_chain(
            code=symbol,
            start=expiry,
            end=expiry,
            option_type=ft.OptionType.ALL,
        )
        ctx.close()

        if ret != ft.RET_OK:
            raise HTTPException(500, f"get_option_chain failed: {data}")

        if data is None or len(data) == 0:
            logger.warning(f"Option chain empty for {symbol} expiry={expiry}")
            return {"symbol": symbol, "expiry": expiry, "rows": [], "note": "No data — check expiry date matches Moomoo format"}

        logger.info(f"Option chain columns: {list(data.columns)}")
        logger.info(f"Option chain rows: {len(data)}, sample: {data.iloc[0].to_dict() if len(data) > 0 else {}}")

        # Get spot price FIRST — needed for ATM-priority sorting
        spot = 0
        try:
            qctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
            ret2, snap = qctx.get_market_snapshot([symbol])
            qctx.close()
            spot = safe_f(snap['last_price'].iloc[0]) if ret2 == ft.RET_OK and len(snap) > 0 else 0
        except Exception:
            spot = 0

        # Collect all option codes from chain
        option_codes = [str(row.get('code', '')) for _, row in data.iterrows() if row.get('code')]

        # Build snap_map from live snapshots
        snap_map = {}
        if option_codes:
            try:
                import time
                # Sort ATM-first for subscription priority
                def strike_from_code(c):
                    try:
                        part = c.split('C')[-1] if 'C' in c[8:] else c.split('P')[-1]
                        return abs(float(part) / 1000 - spot)
                    except: return 9999
                codes_sorted = sorted(option_codes, key=strike_from_code)

                sub_ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
                for i in range(0, len(codes_sorted), 50):
                    batch = codes_sorted[i:i+50]
                    ret_sub, msg_sub = sub_ctx.subscribe(batch, [ft.SubType.QUOTE], subscribe_push=False)
                    logger.info(f"Subscribe batch {i//50+1}: ret={ret_sub}")
                time.sleep(1.5)
                for i in range(0, len(codes_sorted), 50):
                    batch = codes_sorted[i:i+50]
                    snap_ret, snap_data = sub_ctx.get_market_snapshot(batch)
                    if snap_ret == ft.RET_OK and len(snap_data) > 0:
                        for _, srow in snap_data.iterrows():
                            snap_map[str(srow.get('code',''))] = srow
                sub_ctx.close()

                # Debug: confirm snap_map coverage
                if snap_map:
                    match_count = sum(1 for c in option_codes if c in snap_map)
                    logger.info(f"Option chain: {len(snap_map)} snapshots, {match_count}/{len(option_codes)} codes matched")
            except Exception as e:
                logger.warning(f"Quote subscription failed: {e}")

        rows = []
        seen_strikes = {}

        for _, row in data.iterrows():
            try:
                strike   = safe_f(row.get('strike_price'))
                if strike == 0:
                    continue
                opt_type = str(row.get('option_type', '')).upper()
                code     = str(row.get('code', ''))
                is_atm   = spot > 0 and abs(strike - spot) / spot < 0.015

                # Read live prices from snap_map — default to 0 if not subscribed
                s      = snap_map.get(code, {})
                bid    = safe_f(s.get('bid_price'))
                ask    = safe_f(s.get('ask_price'))
                last   = safe_f(s.get('last_price'))
                # For expiring options bid/ask may be 0 — use last traded price as reference
                if bid == 0 and ask == 0 and last > 0:
                    bid = round(last * 0.95, 2)
                    ask = round(last * 1.05, 2)
                volume = safe_i(s.get('volume'))
                oi     = safe_i(s.get('option_open_interest'))
                iv     = safe_f(s.get('option_implied_volatility'))
                delta  = safe_f(s.get('option_delta'))
                gamma  = safe_f(s.get('option_gamma'))
                theta  = safe_f(s.get('option_theta'))
                vega   = safe_f(s.get('option_vega'))

                if strike not in seen_strikes:
                    seen_strikes[strike] = {'strike': strike, 'is_atm': is_atm}

                side = 'call' if 'CALL' in opt_type else 'put'
                seen_strikes[strike][f'{side}_bid']    = round(bid,   2)
                seen_strikes[strike][f'{side}_ask']    = round(ask,   2)
                seen_strikes[strike][f'{side}_last']   = round(last,  2)
                seen_strikes[strike][f'{side}_iv']     = round(iv,    1)
                seen_strikes[strike][f'{side}_delta']  = round(delta, 3)
                seen_strikes[strike][f'{side}_gamma']  = round(gamma, 4)
                seen_strikes[strike][f'{side}_theta']  = round(theta, 4)
                seen_strikes[strike][f'{side}_vega']   = round(vega,  4)
                seen_strikes[strike][f'{side}_volume'] = volume
                seen_strikes[strike][f'{side}_oi']     = oi
                seen_strikes[strike][f'{side}_code']   = code
            except Exception as e:
                logger.warning(f"Option row parse error: {e}")
                continue

        # Sort by strike, filter to ±strike_count from ATM
        all_strikes = sorted(seen_strikes.values(), key=lambda r: r['strike'])
        if spot > 0 and strike_count > 0:
            atm_idx = min(range(len(all_strikes)), key=lambda i: abs(all_strikes[i]['strike'] - spot))
            lo = max(0, atm_idx - strike_count)
            hi = min(len(all_strikes), atm_idx + strike_count + 1)
            all_strikes = all_strikes[lo:hi]

        return {
            "symbol":  symbol,
            "expiry":  expiry,
            "spot":    round(spot, 2),
            "rows":    all_strikes,
            "count":   len(all_strikes),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/options/order")
def place_option_order(req: PlaceOrderRequest):
    """
    POST /options/order
    Place an option order via Moomoo.
    symbol must be a full option contract code: US.GOOG260522C380000
    side: BUY | SELL
    qty: number of contracts (1 contract = 100 shares)
    order_type: LIMIT | MARKET
    limit_price: premium per share (e.g. 5.20)
    trade_pwd: injected by Next.js proxy from user profile
    """
    # Validate option code format
    sym = req.symbol.upper()
    if not (sym.startswith('US.') and ('C' in sym[8:] or 'P' in sym[8:])):
        raise HTTPException(400, f"Invalid option code format: {sym}. Expected US.XXXX260522C380000")

    # Option orders must be LIMIT (market orders on options are risky)
    if req.order_type.upper() == 'MARKET':
        raise HTTPException(400, "Market orders not supported for options. Use LIMIT with a price.")

    if not req.limit_price or req.limit_price <= 0:
        raise HTTPException(400, "limit_price required for option orders (premium per share)")

    # Reuse existing order placement — it already handles option codes
    return place_order_moomoo(req)



@app.get("/account/funds")
def get_account_funds():
    """
    GET /account/funds
    Returns buying power, cash, and asset values per currency from real account.
    """
    ctx = None
    try:
        import time
        ctx = ft.OpenSecTradeContext(
            host=OPEND_HOST, port=OPEND_PORT,
            security_firm=ft.SecurityFirm.FUTUAU,
        )
        ret, acc_data = ctx.get_acc_list()
        if ret != ft.RET_OK or len(acc_data) == 0:
            raise HTTPException(500, "Cannot get account list")

        # Get real account
        use_acc, use_env = None, None
        for _, row in acc_data.iterrows():
            if str(row.get('trd_env', '')) == 'REAL':
                use_acc, use_env = row['acc_id'], row['trd_env']
                break
        if use_acc is None:
            use_acc, use_env = acc_data.iloc[0]['acc_id'], acc_data.iloc[0]['trd_env']

        ret2, funds = ctx.accinfo_query(trd_env=use_env, acc_id=use_acc)
        if ret2 != ft.RET_OK:
            raise HTTPException(500, f"accinfo_query failed: {funds}")

        logger.info(f"accinfo columns: {list(funds.columns)}")
        logger.info(f"accinfo data: {funds.iloc[0].to_dict()}")

        row = funds.iloc[0]
        raw = {k: str(v) for k, v in row.items()}

        # Structure the multi-currency breakdown
        currencies = []
        for code, prefix in [('USD','us'), ('AUD','au'), ('HKD','hk'), ('SGD','sg'), ('CNH','cn')]:
            cash_val = safe_f(row.get(f'{prefix}_cash'))
            assets   = safe_f(row.get(f'{code.lower()}_assets') or row.get(f'{prefix}_assets'))
            power    = safe_f(row.get(f'{code.lower()}_net_cash_power'))
            if cash_val > 0 or assets > 0:
                currencies.append({
                    'currency':  code,
                    'cash':      round(cash_val, 2),
                    'assets':    round(assets, 2),
                    'buying_power': round(power, 2),
                })

        return {
            "account":      str(use_acc),
            "trd_env":      str(use_env),
            "base_currency": str(row.get('currency', 'HKD')),
            "total_assets": safe_f(row.get('total_assets')),
            "market_val":   safe_f(row.get('market_val')),
            "cash":         safe_f(row.get('cash')),
            "buying_power": safe_f(row.get('power')),
            "currencies":   currencies,
            "raw":          raw,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if ctx:
            try: ctx.close()
            except: pass

@app.get("/options/volatility")
def get_stock_volatility(symbol: str):
    """
    GET /options/volatility?symbol=US.GOOG
    Returns IV, IV Rank, IV Percentile, Historical Volatility from market snapshot.
    These are per-stock metrics shown in Moomoo's Options tab header.
    """
    try:
        import time
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)

        # Subscribe to get fresh data
        ret_sub, _ = ctx.subscribe([symbol], [ft.SubType.QUOTE], subscribe_push=False)
        time.sleep(0.5)

        ret, snap = ctx.get_market_snapshot([symbol])
        if ret != ft.RET_OK or len(snap) == 0:
            ctx.close()
            raise HTTPException(500, f"Cannot get snapshot for {symbol}")

        row = snap.iloc[0]
        logger.info(f"All snapshot fields: { {k: str(v) for k, v in row.items() if str(v) not in ['nan', 'N/A', '0.0', 'None', '0']} }")

        # Try get_option_chain_expiry_date_list which has aggregate IV data
        # Also try get_capital_flow and get_plate_stock for IV rank
        # Check if Moomoo has a dedicated IV rank query
        try:
            ret_iv, iv_data = ctx.get_option_expiration_date(symbol)
            logger.info(f"Expiry data columns: {list(iv_data.columns) if ret_iv == ft.RET_OK else 'failed'}")
            if ret_iv == ft.RET_OK and len(iv_data) > 0:
                logger.info(f"Expiry sample: {iv_data.iloc[0].to_dict()}")
        except Exception as e:
            logger.warning(f"Expiry data failed: {e}")

        # Get option chain for ATM IV
        expiries_ret, exp_data = ctx.get_option_expiration_date(symbol)
        atm_iv = None
        if expiries_ret == ft.RET_OK and len(exp_data) > 0:
            from datetime import datetime, timedelta
            today = datetime.now().date().isoformat()
            future_expiries = [e for e in exp_data['strike_time'].tolist() if e > today]
            if future_expiries:
                nearest = future_expiries[0]
                chain_ret, chain_data = ctx.get_option_chain(
                    code=symbol, start=nearest, end=nearest,
                    option_type=ft.OptionType.ALL,
                )
                if chain_ret == ft.RET_OK and len(chain_data) > 0:
                    # Get spot for ATM detection
                    spot = safe_f(row.get('last_price'))
                    # Collect IVs from ATM strikes via snapshot
                    atm_codes = []
                    for _, crow in chain_data.iterrows():
                        strike = safe_f(crow.get('strike_price'))
                        if spot > 0 and abs(strike - spot) / spot < 0.02:
                            atm_codes.append(str(crow.get('code', '')))

                    if atm_codes:
                        ctx.subscribe(atm_codes[:10], [ft.SubType.QUOTE], subscribe_push=False)
                        time.sleep(0.5)
                        snap_ret, atm_snap = ctx.get_market_snapshot(atm_codes[:10])
                        if snap_ret == ft.RET_OK and len(atm_snap) > 0:
                            ivs = [safe_f(r.get('option_implied_volatility')) for _, r in atm_snap.iterrows() if safe_f(r.get('option_implied_volatility')) > 0]
                            if ivs:
                                atm_iv = round(sum(ivs) / len(ivs), 2)

        ctx.close()

        return {
            "symbol":              symbol,
            "last_price":          safe_f(row.get('last_price')),
            "iv":                  atm_iv,
            # Moomoo stores these as stock-level fields — check what's available
            "iv_rank":             safe_f(row.get('option_iv_rank'))             or None,
            "iv_percentile":       safe_f(row.get('option_iv_percentile'))       or None,
            "historical_vol_30d":  safe_f(row.get('historical_volatility'))      or None,
            "put_call_ratio":      safe_f(row.get('option_put_call_ratio'))      or None,
            "open_interest":       safe_f(row.get('option_open_interest_total')) or None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/kline")
def get_kline(symbol: str = "US.AAPL", kl_type: str = "60M", count: int = 50):
    """
    Fetch historical kline (OHLCV) data for MACD and indicator calculations.
    kl_type: 1M, 3M, 5M, 15M, 30M, 60M, DAY, WEEK, MON
    Returns candles sorted oldest first.
    """
    import math
    from datetime import datetime, timedelta
    from moomoo import KLType

    kl_map = {
        "1M":   KLType.K_1M,
        "3M":   KLType.K_3M,
        "5M":   KLType.K_5M,
        "15M":  KLType.K_15M,
        "30M":  KLType.K_30M,
        "60M":  KLType.K_60M,
        "DAY":  KLType.K_DAY,
        "WEEK": KLType.K_WEEK,
        "MON":  KLType.K_MON,
    }
    kl = kl_map.get(kl_type.upper(), KLType.K_60M)

    # Calculate lookback window — need 35+ candles for MACD
    days_back = 10 if kl_type in ('60M', '30M', '15M', '5M', '3M', '1M') else 90

    try:
        start_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        end_date   = datetime.now().strftime('%Y-%m-%d')

        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        try:
            ret, data, _ = ctx.request_history_kline(
                symbol,
                start=start_date,
                end=end_date,
                ktype=kl,
            )
        finally:
            ctx.close()

        if ret != ft.RET_OK:
            raise HTTPException(400, f"Kline error: {data}")

        def sf(v):
            try:
                f = float(v)
                return None if math.isnan(f) or math.isinf(f) else round(f, 4)
            except Exception:
                return None

        klines = []
        for _, row in data.iterrows():
            klines.append({
                "time":   str(row.get("time_key", "")),
                "open":   sf(row.get("open",   0)),
                "high":   sf(row.get("high",   0)),
                "low":    sf(row.get("low",    0)),
                "close":  sf(row.get("close",  0)),
                "volume": sf(row.get("volume", row.get("turnover", 0))),
            })

        # Trim to requested count (most recent N candles)
        klines = klines[-count:] if len(klines) > count else klines

        return {
            "symbol":  symbol,
            "kl_type": kl_type,
            "count":   len(klines),
            "klines":  klines,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/options/debug_snapshot")
def debug_option_snapshot(code: str = "US.GOOG260522C380000"):
    """Debug: test live snapshot for a single option contract."""
    try:
        import time
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)

        # Subscribe
        ret_sub, msg_sub = ctx.subscribe([code], [ft.SubType.QUOTE], subscribe_push=False)
        logger.info(f"Subscribe ret={ret_sub} msg={msg_sub}")
        time.sleep(1)

        # Snapshot
        ret_snap, snap = ctx.get_market_snapshot([code])
        snap_data = {}
        if ret_snap == ft.RET_OK and len(snap) > 0:
            snap_data = {k: str(v) for k, v in snap.iloc[0].items()}
            logger.info(f"Snapshot: {snap_data}")

        # Basic quote
        ret_q, quote = ctx.get_stock_quote([code])
        quote_data = {}
        if ret_q == ft.RET_OK and len(quote) > 0:
            quote_data = {k: str(v) for k, v in quote.iloc[0].items()}

        ctx.close()
        return {
            "code":      code,
            "subscribe": {"ret": ret_sub, "msg": str(msg_sub)},
            "snapshot":  snap_data,
            "quote":     quote_data,
        }
    except Exception as e:
        return {"error": str(e)}


def get_iv_rank(symbol: str, lookback_days: int = 252):
    """
    GET /options/iv_rank?symbol=US.GOOG
    Approximates IV Rank from historical option chain IV data.
    IV Rank = (current IV - 52w low IV) / (52w high IV - 52w low IV) * 100
    """
    try:
        # Get current ATM IV from latest chain
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)

        # Get expiry dates
        ret, exp_data = ctx.get_option_expiration_date(symbol)
        if ret != ft.RET_OK or len(exp_data) == 0:
            ctx.close()
            raise HTTPException(500, "Cannot get expiry dates")

        # Use nearest expiry ~30 DTE
        from datetime import datetime, timedelta
        target = datetime.now() + timedelta(days=30)
        expiries = exp_data['strike_time'].tolist()
        nearest  = min(expiries, key=lambda d: abs((datetime.strptime(d[:10], '%Y-%m-%d') - target).days))

        ret2, chain = ctx.get_option_chain(code=symbol, start=nearest, end=nearest, option_type=ft.OptionType.ALL)
        ctx.close()

        if ret2 != ft.RET_OK or chain is None or len(chain) == 0:
            raise HTTPException(500, "Cannot get option chain for IV")

        # Get ATM IV (average of call + put ATM IV)
        ivs = [float(r) * 100 for r in chain['implied_volatility'] if r and float(r) > 0]
        current_iv = sum(ivs) / len(ivs) if ivs else 0

        # IV Rank: without historical data, estimate from current IV percentile
        # A proper implementation would store daily IV snapshots
        # For now return current IV with note
        return {
            "symbol":     symbol,
            "current_iv": round(current_iv, 1),
            "iv_rank":    None,  # requires historical IV storage
            "note":       "IV Rank requires historical data. Current IV shown.",
            "expiry_used": nearest,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Conditional order monitor ─────────────────────────────────────────────────
# Runs in background thread, polls every 60s during US market hours
# Checks conditional_orders table and executes when conditions are met

import threading
import requests as _requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

def _et_time() -> str:
    """Current time in US Eastern timezone HH:MM"""
    from datetime import datetime
    import zoneinfo
    try:
        et = datetime.now(zoneinfo.ZoneInfo("America/New_York"))
        return et.strftime("%H:%M")
    except Exception:
        return "00:00"

def _is_market_hours() -> bool:
    from datetime import datetime
    import zoneinfo
    try:
        et = datetime.now(zoneinfo.ZoneInfo("America/New_York"))
        if et.weekday() >= 5: return False  # weekend
        t = et.strftime("%H:%M")
        return "09:30" <= t <= "16:00"
    except Exception:
        return False

def _get_price(ticker: str) -> float:
    """Get live price for a ticker via OpenD"""
    try:
        ctx = ft.OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        ctx.subscribe([f"US.{ticker}"], [ft.SubType.QUOTE], subscribe_push=False)
        import time; time.sleep(0.3)
        ret, snap = ctx.get_market_snapshot([f"US.{ticker}"])
        ctx.close()
        if ret == ft.RET_OK and len(snap) > 0:
            return safe_f(snap.iloc[0].get("last_price"))
    except Exception as e:
        logger.warning(f"Price fetch failed for {ticker}: {e}")
    return 0.0

def _supabase_get(path: str) -> list:
    if not SUPABASE_URL or not SUPABASE_KEY: return []
    try:
        r = _requests.get(
            f"{SUPABASE_URL}/rest/v1/{path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=10,
        )
        return r.json() if r.ok else []
    except Exception as e:
        logger.warning(f"Supabase GET failed: {e}")
        return []

def _supabase_patch(table: str, id_: str, data: dict):
    if not SUPABASE_URL or not SUPABASE_KEY: return
    try:
        _requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{id_}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
            json=data, timeout=10,
        )
    except Exception as e:
        logger.warning(f"Supabase PATCH failed: {e}")

def _supabase_post(table: str, data: dict):
    if not SUPABASE_URL or not SUPABASE_KEY: return
    try:
        _requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            json=data, timeout=10,
        )
    except Exception as e:
        logger.warning(f"Supabase POST failed: {e}")

def conditional_order_monitor():
    import time
    logger.info("Conditional order monitor started")
    while True:
        try:
            time.sleep(60)
            if not _is_market_hours():
                continue

            et_time = _et_time()
            now_iso = __import__("datetime").datetime.utcnow().isoformat() + "Z"

            # Fetch active orders with profile data
            orders = _supabase_get(
                "conditional_orders?status=eq.active&select=*,profiles!inner(moomoo_password,trading_mode,trade_account)"
            )
            if not orders:
                continue

            logger.info(f"[monitor] {et_time} ET — checking {len(orders)} conditional orders")

            # Group by ticker for efficient price fetching
            tickers = list({o["ticker"] for o in orders})
            prices = {t: _get_price(t) for t in tickers}

            for order in orders:
                ticker = order["ticker"]
                price  = prices.get(ticker, 0)
                if price == 0:
                    continue

                # Update last checked
                _supabase_patch("conditional_orders", order["id"], {
                    "last_checked_at": now_iso, "last_price_seen": price
                })

                # Time gate
                nbt = order.get("not_before_time") or "10:00"
                if et_time < nbt:
                    continue

                # Date gate
                nbd = order.get("not_before_date")
                if nbd and now_iso[:10] < nbd:
                    continue

                # Price conditions
                pa = order.get("price_above")
                pb = order.get("price_below")
                if pa and price <= float(pa): continue
                if pb and price >= float(pb): continue

                # All conditions met — execute
                logger.info(f"[monitor] Conditions met for {ticker} @ ${price} — executing {order['side']} {order['qty']}")
                try:
                    profile = order.get("profiles", {})
                    body = {
                        "symbol":       order.get("option_code") or f"US.{ticker}",
                        "side":         order["side"],
                        "qty":          order["qty"],
                        "order_type":   order.get("order_type", "LIMIT"),
                        "trade_pwd":    profile.get("moomoo_password", ""),
                        "account_id":   profile.get("trade_account", ""),
                        "trading_mode": profile.get("trading_mode", "paper"),
                    }
                    if order.get("order_type") == "LIMIT" and order.get("limit_price"):
                        body["limit_price"] = float(order["limit_price"])

                    endpoint = "/options/order" if order.get("asset_type") == "option" else "/orders/moomoo"
                    res = _requests.post(f"http://127.0.0.1:{SERVICE_PORT}{endpoint}", json=body, timeout=15)
                    data = res.json()

                    if res.ok and data.get("order_id"):
                        logger.info(f"[monitor] ✓ Executed {ticker} — order_id={data['order_id']}")
                        _supabase_patch("conditional_orders", order["id"], {
                            "status": "triggered", "triggered_at": now_iso,
                            "executed_order_id": data["order_id"], "updated_at": now_iso,
                        })
                        _supabase_post("broker_orders", {
                            "user_id": order["user_id"], "order_id": data["order_id"],
                            "ticker": ticker, "side": order["side"], "qty": order["qty"],
                            "price": data.get("price") or order.get("limit_price"),
                            "order_type": order.get("order_type", "LIMIT"),
                            "status": "PLACED", "account": data.get("account"),
                            "trd_env": data.get("trd_env"),
                        })
                    else:
                        reason = data.get("detail", "Unknown error")
                        logger.warning(f"[monitor] ✗ Execution failed for {ticker}: {reason}")
                        _supabase_patch("conditional_orders", order["id"], {
                            "status": "failed", "fail_reason": reason, "updated_at": now_iso,
                        })
                except Exception as e:
                    logger.error(f"[monitor] Exception executing {ticker}: {e}")
                    _supabase_patch("conditional_orders", order["id"], {
                        "status": "failed", "fail_reason": str(e), "updated_at": now_iso,
                    })

        except Exception as e:
            logger.error(f"[monitor] Loop error: {e}")



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
    # Start conditional order monitor in background thread
    if SUPABASE_URL and SUPABASE_KEY:
        monitor_thread = threading.Thread(target=conditional_order_monitor, daemon=True)
        monitor_thread.start()
        logger.info("✓ Conditional order monitor started (polls every 60s during market hours)")
    else:
        logger.warning("SUPABASE_URL or SUPABASE_SERVICE_KEY not set — conditional order monitor disabled")
        logger.warning("Set env vars and restart to enable conditional orders")

    uvicorn.run("broker_service:app", host="127.0.0.1", port=SERVICE_PORT, reload=False)
