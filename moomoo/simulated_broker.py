"""
simulated_broker.py
Quant IQ — SimulatedBroker

A drop-in paper trading layer that intercepts all place_order() calls and fills
them against live Moomoo bid/ask data, without touching a real account.

Architecture:
  Strategy engine
      └─► SimulatedBroker.place_order()   ← same interface as live trading
              ├─► MoomooConnector (quote feed only — reads live bid/ask)
              ├─► Fill engine (checks order vs live price)
              ├─► Portfolio state (positions, cash, P&L)
              └─► Trade log (every order event, fill, slippage)

Switching to live trading later requires only one change in your strategy:
    broker = SimulatedBroker(...)   →   broker = LiveBroker(...)
All strategy logic stays identical.

Usage:
    from simulated_broker import SimulatedBroker, OrderSide, OrderType

    broker = SimulatedBroker(initial_cash=100_000.0)
    broker.connect()

    # Place a limit order
    order_id = broker.place_order("US.AAPL", OrderSide.BUY, qty=10,
                                   order_type=OrderType.LIMIT, limit_price=290.00)

    # Place a market order (fills at current ask/bid)
    order_id = broker.place_order("US.TSLA", OrderSide.BUY, qty=5,
                                   order_type=OrderType.MARKET)

    # Check fills, positions, P&L
    broker.run_fill_cycle()          # call this on each market data tick
    positions  = broker.get_positions()
    pnl        = broker.get_pnl()
    trade_log  = broker.get_trade_log()

    broker.disconnect()

Requirements:
    pip install moomoo-api
    OpenD must be running and logged in before creating SimulatedBroker.
"""

import moomoo as ft
import threading
import time
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Dict, List, Callable

logger = logging.getLogger(__name__)


# ─── ENUMS ─────────────────────────────────────────────────────────────────────

class OrderSide(Enum):
    BUY  = "BUY"
    SELL = "SELL"

class OrderType(Enum):
    MARKET     = "MARKET"      # Fill immediately at current ask (buy) or bid (sell)
    LIMIT      = "LIMIT"       # Fill only when price crosses limit_price
    STOP       = "STOP"        # Trigger market fill when price crosses stop_price
    STOP_LIMIT = "STOP_LIMIT"  # Trigger limit fill when price crosses stop_price

class OrderStatus(Enum):
    PENDING   = "PENDING"    # Submitted, not yet filled
    FILLING   = "FILLING"    # Reserved by fill engine — prevents double-fill
    FILLED    = "FILLED"     # Fully executed
    CANCELLED = "CANCELLED"  # Cancelled before fill
    REJECTED  = "REJECTED"   # Rejected (e.g. insufficient cash)


# ─── DATA CLASSES ──────────────────────────────────────────────────────────────

@dataclass
class Order:
    order_id:    str
    symbol:      str
    side:        OrderSide
    order_type:  OrderType
    qty:         int
    limit_price: Optional[float]   = None   # Required for LIMIT / STOP_LIMIT
    stop_price:  Optional[float]   = None   # Required for STOP / STOP_LIMIT
    status:      OrderStatus       = OrderStatus.PENDING
    fill_price:  Optional[float]   = None
    fill_time:   Optional[datetime]= None
    created_at:  datetime          = field(default_factory=datetime.now)
    commission:  float             = 0.0
    slippage:    float             = 0.0
    notes:       str               = ""

@dataclass
class Position:
    symbol:        str
    qty:           int              # Positive = long, negative = short
    avg_cost:      float            # Average fill price
    market_price:  float = 0.0     # Last known market price
    unrealised_pnl: float = 0.0

    @property
    def market_value(self) -> float:
        return self.qty * self.market_price

    @property
    def cost_basis(self) -> float:
        return abs(self.qty) * self.avg_cost


# ─── QUOTE HANDLER ─────────────────────────────────────────────────────────────

class _QuoteHandler(ft.StockQuoteHandlerBase):
    """Internal handler — captures live bid/ask into a shared price cache."""

    def __init__(self, price_cache: dict, fill_callback: Callable):
        super().__init__()
        self._cache    = price_cache
        self._callback = fill_callback

    def on_recv_rsp(self, rsp_str):
        ret, data = super().on_recv_rsp(rsp_str)
        if ret == ft.RET_OK:
            for _, row in data.iterrows():
                symbol = row["code"]
                bid  = float(row.get("bid_price", 0.0) or 0.0)
                ask  = float(row.get("ask_price", 0.0) or 0.0)
                last = float(row.get("last_price", 0.0) or 0.0)
                existing = self._cache.get(symbol, {})
                # Never overwrite valid prices with zeros
                # (happens when market is closed or data is stale)
                self._cache[symbol] = {
                    "bid":  bid  if bid  > 0 else existing.get("bid",  0.0),
                    "ask":  ask  if ask  > 0 else existing.get("ask",  0.0),
                    "last": last if last > 0 else existing.get("last", 0.0),
                    "time": datetime.now(),
                }
            self._callback()   # trigger fill cycle on every price update
        return ret, data


# ─── SIMULATED BROKER ──────────────────────────────────────────────────────────

class SimulatedBroker:
    """
    Paper trading broker that fills orders against live Moomoo bid/ask prices.

    Parameters
    ----------
    initial_cash : float
        Starting virtual cash balance (default $100,000).
    commission_per_trade : float
        Flat commission charged per filled order (default $0.00 — zero commission
        like moomoo live). Set e.g. 1.00 to simulate a $1/trade broker.
    slippage_bps : float
        Slippage in basis points added to fill price (default 2bps = 0.02%).
        Buys fill slightly above ask, sells slightly below bid.
    opend_host : str
        OpenD host (default 127.0.0.1).
    opend_port : int
        OpenD TCP port (default 11111).
    auto_subscribe : bool
        If True, automatically subscribes to QUOTE data for any symbol you
        place an order on. Default True.
    """

    def __init__(
        self,
        initial_cash: float        = 100_000.0,
        commission_per_trade: float = 0.0,
        slippage_bps: float         = 2.0,
        opend_host: str             = "127.0.0.1",
        opend_port: int             = 11111,
        auto_subscribe: bool        = True,
    ):
        self._cash              = initial_cash
        self._initial_cash      = initial_cash
        self._commission        = commission_per_trade
        self._slippage_bps      = slippage_bps
        self._host              = opend_host
        self._port              = opend_port
        self._auto_subscribe    = auto_subscribe

        self._quote_ctx: Optional[ft.OpenQuoteContext] = None
        self._price_cache: Dict[str, dict]             = {}
        self._subscribed_symbols: set                  = set()

        self._orders:     Dict[str, Order]    = {}   # order_id → Order
        self._positions:  Dict[str, Position] = {}   # symbol → Position
        self._trade_log:  List[dict]          = []

        self._lock = threading.RLock()  # reentrant — safe from push handler thread
        self._connected = False

    # ── CONNECTION ─────────────────────────────────────────────────────────────

    def connect(self):
        """Start OpenD connection and the quote context."""
        self._quote_ctx = ft.OpenQuoteContext(host=self._host, port=self._port)
        self._quote_ctx.start()
        self._quote_ctx.set_handler(
            _QuoteHandler(self._price_cache, self.run_fill_cycle)
        )
        self._connected = True
        logger.info(f"SimulatedBroker connected to OpenD at {self._host}:{self._port}")
        logger.info(f"Starting cash: ${self._cash:,.2f}")

    def disconnect(self):
        """Close the quote context cleanly."""
        if self._quote_ctx:
            if self._subscribed_symbols:
                self._quote_ctx.unsubscribe(
                    list(self._subscribed_symbols), [ft.SubType.QUOTE]
                )
            self._quote_ctx.close()
            self._connected = False
        logger.info("SimulatedBroker disconnected.")

    def _ensure_subscribed(self, symbol: str):
        """Subscribe to real-time quotes for a symbol if not already subscribed."""
        if self._auto_subscribe and symbol not in self._subscribed_symbols:
            ret, err = self._quote_ctx.subscribe([symbol], [ft.SubType.QUOTE])
            if ret == ft.RET_OK:
                self._subscribed_symbols.add(symbol)
                logger.debug(f"Subscribed to QUOTE for {symbol}")
            else:
                logger.warning(f"Could not subscribe to {symbol}: {err}")

    def _get_live_price(self, symbol: str) -> Optional[dict]:
        """
        Fetch current bid/ask for a symbol.
        First checks the push cache; falls back to a snapshot pull if empty.
        """
        if symbol in self._price_cache:
            return self._price_cache[symbol]

        # Cache miss — pull snapshot directly
        ret, data = self._quote_ctx.get_market_snapshot([symbol])
        if ret == ft.RET_OK and len(data) > 0:
            row = data.iloc[0]
            prices = {
                "bid":  row.get("bid_price", 0.0),
                "ask":  row.get("ask_price", 0.0),
                "last": row.get("last_price", 0.0),
                "time": datetime.now(),
            }
            self._price_cache[symbol] = prices
            return prices
        return None

    # ── ORDER PLACEMENT ────────────────────────────────────────────────────────

    def place_order(
        self,
        symbol:      str,
        side:        OrderSide,
        qty:         int,
        order_type:  OrderType          = OrderType.MARKET,
        limit_price: Optional[float]    = None,
        stop_price:  Optional[float]    = None,
    ) -> Optional[str]:
        """
        Submit a virtual order. Returns the order_id string, or None if rejected.

        Parameters
        ----------
        symbol      : Moomoo format, e.g. "US.AAPL"
        side        : OrderSide.BUY or OrderSide.SELL
        qty         : Number of shares/contracts (must be > 0)
        order_type  : MARKET, LIMIT, STOP, or STOP_LIMIT
        limit_price : Required for LIMIT and STOP_LIMIT orders
        stop_price  : Required for STOP and STOP_LIMIT orders
        """
        if not self._connected:
            raise RuntimeError("SimulatedBroker not connected. Call connect() first.")

        if qty <= 0:
            logger.error(f"Rejected: qty must be > 0, got {qty}")
            return None

        if order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and limit_price is None:
            logger.error(f"Rejected: {order_type.value} order requires limit_price")
            return None

        if order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and stop_price is None:
            logger.error(f"Rejected: {order_type.value} order requires stop_price")
            return None

        self._ensure_subscribed(symbol)

        # Always pre-populate price cache before placing any order so
        # bid/ask are never zero when run_fill_cycle fires immediately after
        self._get_live_price(symbol)

        if side == OrderSide.BUY:
            prices = self._get_live_price(symbol)
            if prices:
                est_price = limit_price or prices["ask"] or prices["last"]
                est_cost  = est_price * qty + self._commission
                if est_cost > self._cash:
                    order_id = str(uuid.uuid4())[:8]
                    logger.warning(
                        f"Order {order_id} REJECTED: insufficient cash "
                        f"(need ${est_cost:,.2f}, have ${self._cash:,.2f})"
                    )
                    self._log_event(order_id, symbol, side, order_type, qty,
                                    limit_price, stop_price, OrderStatus.REJECTED,
                                    notes="Insufficient cash")
                    return None

        order_id = str(uuid.uuid4())[:8]
        order = Order(
            order_id=order_id,
            symbol=symbol,
            side=side,
            order_type=order_type,
            qty=qty,
            limit_price=limit_price,
            stop_price=stop_price,
        )

        with self._lock:
            self._orders[order_id] = order

        logger.info(
            f"Order {order_id} PENDING: {side.value} {qty} {symbol} "
            f"@ {order_type.value}"
            + (f" limit={limit_price}" if limit_price else "")
            + (f" stop={stop_price}"   if stop_price  else "")
        )
        self._log_event(order_id, symbol, side, order_type, qty,
                        limit_price, stop_price, OrderStatus.PENDING)

        # Market orders: re-fetch price then fill
        # Re-fetch ensures SELL side has a valid bid (not just ask)
        if order_type == OrderType.MARKET:
            self._price_cache.pop(symbol, None)  # force fresh snapshot
            self._get_live_price(symbol)
            self.run_fill_cycle()
        else:
            # For LIMIT/STOP orders, run one fill cycle immediately using
            # the freshly fetched snapshot price — catches orders that
            # should fill right away (e.g. limit above current ask)
            self.run_fill_cycle()

        return order_id

    def cancel_order(self, order_id: str) -> bool:
        """Cancel a pending order. Returns True if cancelled, False if not found or already filled."""
        with self._lock:
            order = self._orders.get(order_id)
            if order and order.status == OrderStatus.PENDING:
                order.status = OrderStatus.CANCELLED
                self._log_event(
                    order_id, order.symbol, order.side, order.order_type,
                    order.qty, order.limit_price, order.stop_price,
                    OrderStatus.CANCELLED
                )
                logger.info(f"Order {order_id} CANCELLED")
                return True
        return False

    # ── FILL ENGINE ────────────────────────────────────────────────────────────

    def run_fill_cycle(self):
        """
        Check all PENDING orders against current live prices and fill any
        that have their conditions met.

        Call this:
          - Automatically: happens on every real-time quote push (auto_subscribe=True)
          - Manually: call broker.run_fill_cycle() on each strategy tick
        """
        # Snapshot pending orders without holding the lock — avoids blocking
        # the push handler thread while the main thread is also filling
        pending = [o for o in list(self._orders.values())
                   if o.status == OrderStatus.PENDING]

        for order in pending:
            prices = self._get_live_price(order.symbol)
            if not prices:
                continue

            bid  = prices.get("bid",  0.0)
            ask  = prices.get("ask",  0.0)
            last = prices.get("last", 0.0)

            fill_price = self._check_fill(order, bid, ask, last)
            if fill_price is not None:
                self._execute_fill(order, fill_price)

    def _check_fill(
        self, order: Order, bid: float, ask: float, last: float
    ) -> Optional[float]:
        """
        Determine if an order should fill given current bid/ask/last.
        Returns the fill price if the order fills, else None.

        Fill logic:
          MARKET     : always fills — BUY at ask, SELL at bid
          LIMIT      : BUY fills when ask <= limit_price
                       SELL fills when bid >= limit_price
          STOP       : BUY triggers when last >= stop_price → fills at ask
                       SELL triggers when last <= stop_price → fills at bid
          STOP_LIMIT : BUY triggers when last >= stop_price → fills when ask <= limit_price
                       SELL triggers when last <= stop_price → fills when bid >= limit_price
        """
        # Guard: never fill at zero — means price data hasn't arrived yet
        if ask <= 0 or bid <= 0:
            return None

        if order.order_type == OrderType.MARKET:
            return ask if order.side == OrderSide.BUY else bid

        if order.order_type == OrderType.LIMIT:
            if order.side == OrderSide.BUY  and ask <= order.limit_price:
                return ask
            if order.side == OrderSide.SELL and bid >= order.limit_price:
                return bid

        if order.order_type == OrderType.STOP:
            if order.side == OrderSide.BUY  and last >= order.stop_price:
                return ask
            if order.side == OrderSide.SELL and last <= order.stop_price:
                return bid

        if order.order_type == OrderType.STOP_LIMIT:
            if order.side == OrderSide.BUY:
                if last >= order.stop_price and ask <= order.limit_price:
                    return ask
            if order.side == OrderSide.SELL:
                if last <= order.stop_price and bid >= order.limit_price:
                    return bid

        return None

    def _execute_fill(self, order: Order, raw_fill_price: float):
        """Apply slippage, commission, update positions and cash."""
        # Double-fill guard: re-check status inside the lock
        # Two threads (main + push handler) can both pass _check_fill
        # before either has updated the order status
        with self._lock:
            if order.status != OrderStatus.PENDING:
                return  # already filled or cancelled by another thread
            order.status = OrderStatus.FILLING  # reserve the fill slot

        slip_factor = self._slippage_bps / 10_000
        if order.side == OrderSide.BUY:
            fill_price = raw_fill_price * (1 + slip_factor)
        else:
            fill_price = raw_fill_price * (1 - slip_factor)

        slippage   = abs(fill_price - raw_fill_price) * order.qty
        commission = self._commission
        total_cost = fill_price * order.qty

        with self._lock:
            if order.side == OrderSide.BUY:
                if total_cost + commission > self._cash:
                    order.status = OrderStatus.REJECTED
                    order.notes  = "Insufficient cash at fill time"
                    logger.warning(f"Order {order.order_id} REJECTED at fill: insufficient cash")
                    return
                self._cash -= (total_cost + commission)
                self._update_position(order.symbol, order.qty, fill_price)
            else:
                self._cash += (total_cost - commission)
                self._update_position(order.symbol, -order.qty, fill_price)

            order.status     = OrderStatus.FILLED
            order.fill_price = fill_price
            order.fill_time  = datetime.now()
            order.commission = commission
            order.slippage   = slippage

        logger.info(
            f"Order {order.order_id} FILLED: {order.side.value} {order.qty} "
            f"{order.symbol} @ ${fill_price:.4f}  "
            f"slip=${slippage:.4f}  comm=${commission:.2f}  "
            f"cash=${self._cash:,.2f}"
        )
        self._log_event(
            order.order_id, order.symbol, order.side, order.order_type,
            order.qty, order.limit_price, order.stop_price,
            OrderStatus.FILLED,
            fill_price=fill_price, slippage=slippage, commission=commission
        )

    def _update_position(self, symbol: str, qty_delta: int, fill_price: float):
        """Update position record after a fill (average cost calculation)."""
        if symbol not in self._positions:
            self._positions[symbol] = Position(
                symbol=symbol, qty=0, avg_cost=0.0
            )

        pos = self._positions[symbol]

        if pos.qty == 0:
            pos.qty      = qty_delta
            pos.avg_cost = fill_price

        elif (pos.qty > 0 and qty_delta > 0) or (pos.qty < 0 and qty_delta < 0):
            # Adding to existing position — recalculate average cost
            total_cost   = pos.qty * pos.avg_cost + qty_delta * fill_price
            pos.qty     += qty_delta
            pos.avg_cost = total_cost / pos.qty

        else:
            # Reducing / closing / flipping position
            pos.qty += qty_delta
            if pos.qty == 0:
                pos.avg_cost = 0.0
            elif (pos.qty > 0 and qty_delta > 0) or (pos.qty < 0 and qty_delta < 0):
                pass  # flipped — keep fill_price as new avg_cost
            # If position flipped sign, reset avg_cost
            if (pos.qty > 0 and qty_delta < 0 and pos.qty + qty_delta <= 0) or \
               (pos.qty < 0 and qty_delta > 0 and pos.qty + qty_delta >= 0):
                pos.avg_cost = fill_price

        pos.market_price = fill_price

    # ── PORTFOLIO QUERIES ──────────────────────────────────────────────────────

    def refresh_market_prices(self):
        """Pull current market prices for all open positions and update P&L."""
        symbols = [s for s, p in self._positions.items() if p.qty != 0]
        if not symbols:
            return

        ret, data = self._quote_ctx.get_market_snapshot(symbols)
        if ret == ft.RET_OK:
            for _, row in data.iterrows():
                sym = row["code"]
                if sym in self._positions:
                    self._positions[sym].market_price = row.get("last_price", 0.0)

        # Update unrealised P&L
        for sym, pos in self._positions.items():
            if pos.qty != 0:
                pos.unrealised_pnl = (pos.market_price - pos.avg_cost) * pos.qty

    def get_positions(self) -> List[dict]:
        """Return a list of all open positions with current market value and P&L."""
        self.refresh_market_prices()
        result = []
        for sym, pos in self._positions.items():
            if pos.qty != 0:
                result.append({
                    "symbol":          sym,
                    "qty":             pos.qty,
                    "avg_cost":        round(pos.avg_cost, 4),
                    "market_price":    round(pos.market_price, 4),
                    "market_value":    round(pos.market_value, 2),
                    "cost_basis":      round(pos.cost_basis, 2),
                    "unrealised_pnl":  round(pos.unrealised_pnl, 2),
                    "unrealised_pnl%": round(
                        (pos.unrealised_pnl / pos.cost_basis * 100)
                        if pos.cost_basis else 0, 2
                    ),
                })
        return result

    def get_pnl(self) -> dict:
        """Return overall portfolio P&L summary."""
        self.refresh_market_prices()

        portfolio_value = self._cash
        unrealised_pnl  = 0.0
        total_commission = sum(o.commission for o in self._orders.values()
                               if o.status == OrderStatus.FILLED)

        for pos in self._positions.values():
            if pos.qty != 0:
                portfolio_value += pos.market_value
                unrealised_pnl  += pos.unrealised_pnl

        realised_pnl = portfolio_value - self._initial_cash - unrealised_pnl

        return {
            "initial_cash":     round(self._initial_cash, 2),
            "cash":             round(self._cash, 2),
            "portfolio_value":  round(portfolio_value, 2),
            "unrealised_pnl":   round(unrealised_pnl, 2),
            "realised_pnl":     round(realised_pnl, 2),
            "total_pnl":        round(portfolio_value - self._initial_cash, 2),
            "total_pnl%":       round(
                (portfolio_value - self._initial_cash) / self._initial_cash * 100, 2
            ),
            "total_commission": round(total_commission, 2),
            "open_orders":      sum(1 for o in self._orders.values()
                                    if o.status == OrderStatus.PENDING),
            "filled_orders":    sum(1 for o in self._orders.values()
                                    if o.status == OrderStatus.FILLED),
        }

    def get_cash(self) -> float:
        return round(self._cash, 2)

    def get_order(self, order_id: str) -> Optional[Order]:
        return self._orders.get(order_id)

    def get_open_orders(self) -> List[Order]:
        return [o for o in self._orders.values() if o.status == OrderStatus.PENDING]

    def get_trade_log(self) -> List[dict]:
        """Return the full trade event log, most recent first."""
        return list(reversed(self._trade_log))

    # ── INTERNAL LOGGING ───────────────────────────────────────────────────────

    def _log_event(
        self, order_id, symbol, side, order_type, qty,
        limit_price, stop_price, status,
        fill_price=None, slippage=None, commission=None, notes=""
    ):
        self._trade_log.append({
            "timestamp":   datetime.now().isoformat(),
            "order_id":    order_id,
            "symbol":      symbol,
            "side":        side.value,
            "order_type":  order_type.value,
            "qty":         qty,
            "limit_price": limit_price,
            "stop_price":  stop_price,
            "status":      status.value,
            "fill_price":  fill_price,
            "slippage":    slippage,
            "commission":  commission,
            "notes":       notes,
        })

    # ── DISPLAY ────────────────────────────────────────────────────────────────

    def print_summary(self):
        """Print a formatted portfolio summary to stdout."""
        pnl  = self.get_pnl()
        pos  = self.get_positions()
        line = "─" * 56

        print(f"\n{line}")
        print(f"  Quant IQ — SimulatedBroker Portfolio Summary")
        print(f"{line}")
        print(f"  Cash:              ${pnl['cash']:>12,.2f}")
        print(f"  Portfolio value:   ${pnl['portfolio_value']:>12,.2f}")
        print(f"  Unrealised P&L:    ${pnl['unrealised_pnl']:>12,.2f}")
        print(f"  Realised P&L:      ${pnl['realised_pnl']:>12,.2f}")
        print(f"  Total P&L:         ${pnl['total_pnl']:>12,.2f}  ({pnl['total_pnl%']:+.2f}%)")
        print(f"  Commission paid:   ${pnl['total_commission']:>12,.2f}")
        print(f"  Filled orders:     {pnl['filled_orders']:>4}")
        print(f"  Open orders:       {pnl['open_orders']:>4}")

        if pos:
            print(f"\n  {'Symbol':<14} {'Qty':>6} {'Avg Cost':>10} "
                  f"{'Mkt Price':>10} {'Unreal P&L':>12} {'%':>7}")
            print(f"  {'─'*14} {'─'*6} {'─'*10} {'─'*10} {'─'*12} {'─'*7}")
            for p in pos:
                sign = "+" if p["unrealised_pnl"] >= 0 else ""
                print(f"  {p['symbol']:<14} {p['qty']:>6,} "
                      f"  ${p['avg_cost']:>8.2f}   ${p['market_price']:>8.2f} "
                      f"  {sign}${p['unrealised_pnl']:>9.2f} "
                      f"  {p['unrealised_pnl%']:>+.2f}%")
        else:
            print(f"\n  No open positions.")
        print(f"{line}\n")
