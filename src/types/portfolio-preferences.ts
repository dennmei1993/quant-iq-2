// src/types/portfolio-preferences.ts

export type RiskAppetite      = "aggressive" | "moderate" | "conservative";
export type InvestmentHorizon = "short" | "medium" | "long";

export interface PortfolioPreferences {
  risk_appetite:      RiskAppetite;
  benchmark:          string;     // e.g. "SPY", "AXJO"
  target_holdings:    number;     // e.g. 20
  preferred_assets:   string[];   // e.g. ["equities", "etf", "crypto"]
  cash_pct:           number;     // 0-100, target cash reserve %
  investment_horizon: InvestmentHorizon;
}

/** Full portfolio row including preferences */
export interface Portfolio extends PortfolioPreferences {
  id:         string;
  name:       string;
  user_id:    string;
  created_at: string | null;
}

/**
 * Builds the preferences payload for a new portfolio,
 * seeding from the user's profile defaults.
 *
 * Call at portfolio creation time -- after this point the
 * portfolio's preferences are independent of the profile.
 */
export function seedPortfolioPreferences(
  profilePrefs: PortfolioPreferences
): PortfolioPreferences {
  return { ...profilePrefs };
}

/**
 * Fallback defaults used when no profile values are available
 * (e.g. first-time setup, missing profile row).
 */
export const DEFAULT_PORTFOLIO_PREFERENCES: PortfolioPreferences = {
  risk_appetite:      "moderate",
  benchmark:          "SPY",
  target_holdings:    20,
  preferred_assets:   [],
  cash_pct:           0,
  investment_horizon: "long",
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
