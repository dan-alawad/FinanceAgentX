"""
=============================================================================
  Cash Agent - Synthetic Dataset Generator
=============================================================================
  Generates a realistic synthetic financial dataset for training the
  Cash Agent ML model.

  Targets:
    - availableCash      (float, dollars)
    - monthlyExpenses    (float, dollars)
    - cashFlowStatus     (str: "stable", "tight", or "critical")

  Usage:  python generate_dataset.py
  Output: data/training_data.csv  (2000 rows)
=============================================================================
"""

import os
import numpy as np
import pandas as pd

SEED = 42
NUM_SAMPLES = 2000
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "training_data.csv")

INDUSTRIES = ["technology", "retail", "manufacturing", "healthcare", "services"]
INDUSTRY_WEIGHTS = [0.25, 0.20, 0.20, 0.15, 0.20]

INDUSTRY_PROFILES = {
    "technology":     {"revenue_mult": 1.3, "expense_ratio": 0.60, "ar_ratio": 0.30},
    "retail":         {"revenue_mult": 1.0, "expense_ratio": 0.75, "ar_ratio": 0.15},
    "manufacturing":  {"revenue_mult": 1.1, "expense_ratio": 0.70, "ar_ratio": 0.25},
    "healthcare":     {"revenue_mult": 1.2, "expense_ratio": 0.65, "ar_ratio": 0.35},
    "services":       {"revenue_mult": 0.9, "expense_ratio": 0.55, "ar_ratio": 0.20},
}


def generate_dataset(n_samples=NUM_SAMPLES, seed=SEED):
    """Generate a synthetic financial dataset with realistic correlations."""
    rng = np.random.default_rng(seed)

    industries = rng.choice(INDUSTRIES, size=n_samples, p=INDUSTRY_WEIGHTS)

    # Revenue: log-normal distribution ($10K-$500K/month)
    base_revenue = rng.lognormal(mean=11.0, sigma=0.8, size=n_samples)
    base_revenue = np.clip(base_revenue, 10_000, 500_000)
    revenue = np.array([
        base_revenue[i] * INDUSTRY_PROFILES[industries[i]]["revenue_mult"]
        for i in range(n_samples)
    ])

    # Expenses: revenue * industry ratio + noise
    expense_ratios = np.array([INDUSTRY_PROFILES[industries[i]]["expense_ratio"] for i in range(n_samples)])
    total_expenses = revenue * (expense_ratios + rng.normal(0, 0.08, size=n_samples))
    total_expenses = np.clip(total_expenses, revenue * 0.30, revenue * 1.10)

    # Accounts receivable
    ar_ratios = np.array([INDUSTRY_PROFILES[industries[i]]["ar_ratio"] for i in range(n_samples)])
    accounts_receivable = revenue * (ar_ratios + rng.normal(0, 0.05, size=n_samples))
    accounts_receivable = np.clip(accounts_receivable, 0, revenue * 0.60)

    # Accounts payable: 15-45% of expenses
    accounts_payable = total_expenses * rng.uniform(0.15, 0.45, size=n_samples)

    # Current assets & liabilities
    current_assets = accounts_receivable + revenue * rng.uniform(0.5, 1.5, size=n_samples)
    current_liabilities = accounts_payable + total_expenses * rng.uniform(0.15, 0.40, size=n_samples)

    # Previous cash balance
    previous_cash_balance = revenue * rng.uniform(0.3, 1.2, size=n_samples)

    # Company names
    prefixes = ["Alpha", "Beta", "Gamma", "Delta", "Omega", "Nova", "Apex",
                "Prime", "Core", "Peak", "Zen", "Flux", "Nexus", "Vertex"]
    suffixes = ["Corp", "Inc", "LLC", "Group", "Holdings", "Solutions", "Tech"]
    company_names = [f"{rng.choice(prefixes)} {rng.choice(suffixes)} {i+1}" for i in range(n_samples)]

    # ── TARGET 1: availableCash ──
    collection_rate = rng.uniform(0.6, 0.95, size=n_samples)
    available_cash = (
        previous_cash_balance + revenue - total_expenses
        - accounts_payable + accounts_receivable * collection_rate
        + rng.normal(0, revenue * 0.05)
    )
    available_cash = np.clip(available_cash, 1_000, None)

    # ── TARGET 2: monthlyExpenses ──
    monthly_expenses = total_expenses * rng.uniform(0.92, 1.08, size=n_samples)
    monthly_expenses = np.clip(monthly_expenses, 3_000, None)

    # ── TARGET 3: cashFlowStatus ──
    current_ratio = current_assets / np.clip(current_liabilities, 1, None)
    expense_to_revenue = total_expenses / np.clip(revenue, 1, None)

    cash_flow_status = []
    for i in range(n_samples):
        cr, er = current_ratio[i], expense_to_revenue[i]
        if cr > 1.5 and er < 0.70:
            status = "stable"
        elif cr < 0.9 or er > 0.90:
            status = "critical"
        else:
            status = "tight"
        # 10% noise for realism
        if rng.random() < 0.10:
            alts = [s for s in ["stable", "tight", "critical"] if s != status]
            status = rng.choice(alts)
        cash_flow_status.append(status)

    df = pd.DataFrame({
        "companyName": company_names, "industry": industries,
        "revenue": np.round(revenue, 2), "totalExpenses": np.round(total_expenses, 2),
        "accountsReceivable": np.round(accounts_receivable, 2),
        "accountsPayable": np.round(accounts_payable, 2),
        "currentAssets": np.round(current_assets, 2),
        "currentLiabilities": np.round(current_liabilities, 2),
        "previousCashBalance": np.round(previous_cash_balance, 2),
        "availableCash": np.round(available_cash, 2),
        "monthlyExpenses": np.round(monthly_expenses, 2),
        "cashFlowStatus": cash_flow_status,
    })
    return df


def main():
    print("=" * 60)
    print("  Cash Agent - Synthetic Dataset Generator")
    print("=" * 60)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset()
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nDataset generated: {OUTPUT_FILE}")
    print(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns")
    print(f"\n-- Industry Distribution --")
    print(df["industry"].value_counts().to_string())
    print(f"\n-- Cash Flow Status Distribution --")
    print(df["cashFlowStatus"].value_counts().to_string())
    print(f"\n-- Sample Rows --")
    print(df.head(3).to_string())


if __name__ == "__main__":
    main()
