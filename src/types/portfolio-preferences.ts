// src/types/portfolio-preferences.ts

export type RiskAppetite      = "aggressive" | "moderate" | "conservative";
export type InvestmentHorizon = "short" | "medium" | "long";

export interface PortfolioPreferences {
  risk_appetite:      RiskAppetite;
  benchmark:          string;       // e.g. "SPY", "AXJO"
  target_holdings:    number;       // e.g. 20
  preferred_assets:   string[];     // e.g. ["equities", "etf", "crypto"]
  cash_pct:           number;       // 0-100, target cash reserve %
  investment_horizon: InvestmentHorizon;
  total_capital:      number;       // total USD allocated to this portfolio
}

/** Full portfolio row including preferences */
export interface Portfolio extends PortfolioPreferences {
  id:         string;
  name:       string;
  user_id:    string;
  created_at: string | null;
}

/**
 * Capital metrics derived at runtime from holdings + asset_signals.
 * Never stored — always computed fresh.
 */
export interface PortfolioCapitalMetrics {
  total_capital:   number;   // from portfolios.total_capital
  invested:        number;   // sum(quantity * avg_cost) for non-CASH holdings
  cash_available:  number;   // total_capital - invested
  current_value:   number;   // sum(quantity * price_usd) from asset_signals
  capital_gain:    number;   // current_value - invested
  return_pct:      number;   // capital_gain / total_capital * 100
}

/**
 * Compute capital metrics from holdings and live prices.
 * Pass price_usd = null for holdings where no signal data is available
 * (they will be valued at avg_cost as a fallback).
 */
export function computeCapitalMetrics(
  totalCapital: number,
  holdings: Array<{
    ticker:    string;
    quantity:  number | null;
    avg_cost:  number | null;
    price_usd: number | null; // from asset_signals, null if unavailable
  }>
): PortfolioCapitalMetrics {
  let invested     = 0;
  let currentValue = 0;

  for (const h of holdings) {
    if (h.ticker === "CASH") continue; // exclude CASH row from invested calc
    const qty  = h.quantity  ?? 0;
    const cost = h.avg_cost  ?? 0;
    const px   = h.price_usd ?? cost;  // fallback to avg_cost if no live price
    invested     += qty * cost;
    currentValue += qty * px;
  }

  const cashAvailable = Math.max(0, totalCapital - invested);
  const capitalGain   = currentValue - invested;
  const returnPct     = totalCapital > 0
    ? (capitalGain / totalCapital) * 100
    : 0;

  return {
    total_capital:  totalCapital,
    invested,
    cash_available: cashAvailable,
    current_value:  currentValue,
    capital_gain:   capitalGain,
    return_pct:     returnPct,
  };
}

/**
 * Builds the preferences payload for a new portfolio,
 * seeding from the user's profile defaults.
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
