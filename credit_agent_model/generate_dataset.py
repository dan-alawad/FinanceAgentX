"""
=============================================================================
  Credit Agent - Synthetic Dataset Generator
=============================================================================
  Targets:
    - creditScore       (int, 300-850)
    - riskLevel         (str: "low", "moderate", "high")
    - loanEligibility   (str: "approved", "review", "denied")
=============================================================================
"""

import os, numpy as np, pandas as pd

SEED = 42
NUM_SAMPLES = 2000
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "training_data.csv")

INDUSTRIES = ["technology", "retail", "manufacturing", "healthcare", "services"]
INDUSTRY_WEIGHTS = [0.25, 0.20, 0.20, 0.15, 0.20]


def generate_dataset(n_samples=NUM_SAMPLES, seed=SEED):
    rng = np.random.default_rng(seed)
    industries = rng.choice(INDUSTRIES, size=n_samples, p=INDUSTRY_WEIGHTS)

    revenue = rng.lognormal(mean=11.0, sigma=0.8, size=n_samples)
    revenue = np.clip(revenue, 10_000, 500_000)

    # Debt-to-equity ratio
    debt_to_equity = rng.exponential(1.0, size=n_samples)
    debt_to_equity = np.clip(debt_to_equity, 0.05, 8.0)

    # Years in business
    years_in_business = rng.integers(1, 50, size=n_samples)

    # Payment history score (0-100, higher = better)
    payment_history = rng.uniform(30, 100, size=n_samples)

    # Outstanding debt ($)
    outstanding_debt = revenue * rng.uniform(0.1, 2.0, size=n_samples)

    # Credit utilization (%)
    credit_utilization = rng.uniform(5, 95, size=n_samples)

    # Number of late payments (last 12 months)
    late_payments = rng.poisson(2, size=n_samples)
    late_payments = np.clip(late_payments, 0, 20)

    # Collateral value ($)
    collateral_value = revenue * rng.uniform(0.5, 3.0, size=n_samples)

    # Annual growth rate (%)
    annual_growth = rng.normal(5, 15, size=n_samples)

    # ── TARGET 1: creditScore ──
    base_score = 550
    credit_score = (
        base_score
        + payment_history * 1.5
        - debt_to_equity * 25
        + years_in_business * 1.5
        - credit_utilization * 0.8
        - late_payments * 15
        + annual_growth * 1.2
        + rng.normal(0, 20, size=n_samples)
    )
    credit_score = np.clip(credit_score, 300, 850).astype(int)

    # ── TARGET 2: riskLevel ──
    risk_levels = []
    for i in range(n_samples):
        cs = credit_score[i]
        if cs >= 700 and debt_to_equity[i] < 1.5 and late_payments[i] <= 1:
            r = "low"
        elif cs < 550 or debt_to_equity[i] > 3.5 or late_payments[i] > 5:
            r = "high"
        else:
            r = "moderate"
        if rng.random() < 0.08:
            alts = [x for x in ["low", "moderate", "high"] if x != r]
            r = rng.choice(alts)
        risk_levels.append(r)

    # ── TARGET 3: loanEligibility ──
    eligibility = []
    for i in range(n_samples):
        if risk_levels[i] == "low" and credit_score[i] >= 680:
            e = "approved"
        elif risk_levels[i] == "high" or credit_score[i] < 500:
            e = "denied"
        else:
            e = "review"
        if rng.random() < 0.06:
            alts = [x for x in ["approved", "review", "denied"] if x != e]
            e = rng.choice(alts)
        eligibility.append(e)

    df = pd.DataFrame({
        "companyName": [f"Company {i+1}" for i in range(n_samples)],
        "industry": industries,
        "revenue": np.round(revenue, 2),
        "debtToEquity": np.round(debt_to_equity, 3),
        "yearsInBusiness": years_in_business,
        "paymentHistory": np.round(payment_history, 2),
        "outstandingDebt": np.round(outstanding_debt, 2),
        "creditUtilization": np.round(credit_utilization, 2),
        "latePayments": late_payments,
        "collateralValue": np.round(collateral_value, 2),
        "annualGrowth": np.round(annual_growth, 2),
        "creditScore": credit_score,
        "riskLevel": risk_levels,
        "loanEligibility": eligibility,
    })
    return df


def main():
    print("=" * 60)
    print("  Credit Agent - Synthetic Dataset Generator")
    print("=" * 60)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset()
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nDataset: {OUTPUT_FILE} ({df.shape[0]} rows)")
    print(f"\n-- Risk Level Distribution --")
    print(df["riskLevel"].value_counts().to_string())
    print(f"\n-- Loan Eligibility Distribution --")
    print(df["loanEligibility"].value_counts().to_string())
    print(f"\n-- Credit Score Stats --")
    print(df["creditScore"].describe().to_string())

if __name__ == "__main__":
    main()
