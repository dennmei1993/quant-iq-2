// src/types/portfolio-preferences.ts

export type RiskAppetite      = "aggressive" | "moderate" | "conservative";
export type InvestmentHorizon = "short" | "medium" | "long";

export interface PortfolioPreferences {
  risk_appetite:      RiskAppetite;
  benchmark:          string;
  target_holdings:    number;
  preferred_assets:   string[];
  cash_pct:           number;       // 0-100, target cash reserve %
  investment_horizon: InvestmentHorizon;
  total_capital:      number;       // total USD allocated to this portfolio
}

export interface Portfolio extends PortfolioPreferences {
  id:         string;
  name:       string;
  user_id:    string;
  created_at: string | null;
}

/**
 * Capital metrics derived at runtime.
 * Never stored — always computed fresh from holdings + transactions + live prices.
 *
 * Cash model:
 *   cash_available = total_capital
 *                  + Σ sell proceeds       (money returned from closed positions)
 *                  + Σ dividends received
 *                  - Σ buy costs           (money deployed into open positions)
 *                  - Σ fees
 *
 * This correctly reflects that selling at a price above avg_cost returns MORE
 * cash than was originally deployed (realised gain goes back to cash).
 */
export interface PortfolioCapitalMetrics {
  total_capital:    number;   // from portfolios.total_capital
  invested:         number;   // current open cost basis: Σ(qty × avg_cost)
  cash_available:   number;   // transaction-aware available cash
  current_value:    number;   // Σ(qty × live_price) for open positions
  unrealised_gain:  number;   // current_value - invested  (open positions only)
  realised_gain:    number;   // locked-in P&L from all completed sells
  total_gain:       number;   // unrealised_gain + realised_gain
  return_pct:       number;   // total_gain / total_capital * 100
  unrealised_pct:   number;   // unrealised_gain / invested * 100
}

/**
 * Transaction summary used by computeCapitalMetrics.
 * Pass all transactions for the portfolio — buys, sells, dividends, deposits, withdrawals.
 */
export interface TransactionSummary {
  type:         string;
  total_amount: number;
  fees?:        number;
}

/**
 * Compute capital metrics from holdings + transactions + live prices.
 *
 * @param totalCapital  Portfolio's total_capital from DB
 * @param holdings      Current open positions with live prices
 * @param transactions  All transactions (optional — used for accurate cash calc)
 */
export function computeCapitalMetrics(
  totalCapital: number,
  holdings: Array<{
    ticker:        string;
    quantity:      number | null;
    avg_cost:      number | null;
    price_usd:     number | null;
    realised_gain?: number | null;  // from holdings.realised_gain if available
  }>,
  transactions?: TransactionSummary[]
): PortfolioCapitalMetrics {

  // ── Open position metrics ────────────────────────────────────────────────
  let invested     = 0;
  let currentValue = 0;
  let realisedGain = 0;

  for (const h of holdings) {
    if (h.ticker === "CASH") continue;
    const qty  = h.quantity  ?? 0;
    const cost = h.avg_cost  ?? 0;
    const px   = h.price_usd ?? cost;   // fallback to avg_cost if no live price
    invested     += qty * cost;
    currentValue += qty * px;
    realisedGain += h.realised_gain ?? 0;
  }

  // ── Cash calculation ─────────────────────────────────────────────────────
  let cashAvailable: number;

  if (transactions && transactions.length > 0) {
    // Transaction-based cash: accurate after sells
    // Start with total capital, add/subtract each transaction's cash impact
    let cashFromTxns = totalCapital;

    for (const txn of transactions) {
      const amount = Number(txn.total_amount ?? 0);
      const fees   = Number(txn.fees ?? 0);

      switch (txn.type) {
        case "buy":
          // Buying depletes cash by purchase amount + fees
          cashFromTxns -= (amount + fees);
          break;
        case "sell":
          // Selling returns proceeds to cash (amount already = qty × sell_price)
          cashFromTxns += (amount - fees);
          break;
        case "dividend":
          // Dividend income adds to cash
          cashFromTxns += amount;
          break;
        case "deposit":
          // Additional capital added
          cashFromTxns += amount;
          break;
        case "withdrawal":
          // Capital withdrawn
          cashFromTxns -= amount;
          break;
        // split: no cash impact
      }
    }

    cashAvailable = Math.max(0, cashFromTxns);
  } else {
    // Fallback: no transactions — simple total_capital - invested
    // This is the pre-transaction model; cash from sells is implicit
    cashAvailable = Math.max(0, totalCapital - invested);
  }

  // ── Derived metrics ──────────────────────────────────────────────────────
  const unrealisedGain = currentValue - invested;
  const totalGain      = unrealisedGain + realisedGain;
  const returnPct      = totalCapital > 0
    ? (totalGain / totalCapital) * 100
    : 0;
  const unrealisedPct  = invested > 0
    ? (unrealisedGain / invested) * 100
    : 0;

  return {
    total_capital:   totalCapital,
    invested,
    cash_available:  cashAvailable,
    current_value:   currentValue,
    unrealised_gain: unrealisedGain,
    realised_gain:   realisedGain,
    total_gain:      totalGain,
    return_pct:      returnPct,
    unrealised_pct:  unrealisedPct,
  };
}

/**
 * Seed new portfolio preferences from user's QA-derived profile.
 */
export function seedPortfolioPreferences(
  profilePrefs: PortfolioPreferences
): PortfolioPreferences {
  return { ...profilePrefs };
}

export const DEFAULT_PORTFOLIO_PREFERENCES: PortfolioPreferences = {
  risk_appetite:      "moderate",
  benchmark:          "SPY",
  target_holdings:    20,
  preferred_assets:   [],
  cash_pct:           0,
  investment_horizon: "long",
  total_capital:      0,
};

export const PREFERENCE_LABELS = {
  risk_appetite: {
    aggressive:   "Aggressive",
    moderate:     "Moderate",
    conservative: "Conservative",
  },
  investment_horizon: {
    short:  "Short-term (<1yr)",
    medium: "Medium-term (1-3yrs)",
    long:   "Long-term (3+yrs)",
  },
} as const;
