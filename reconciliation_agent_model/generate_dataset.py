"""
=============================================================================
  Reconciliation Agent - Synthetic Dataset Generator
=============================================================================
  Targets:
    - matchedTransactions      (int)
    - unmatchedTransactions     (int)
    - reconciliationStatus     (str: "successful", "partial", "failed")
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

    # Total transactions to reconcile
    total_transactions = rng.integers(20, 500, size=n_samples)

    # Transaction volume (dollar amount)
    transaction_volume = rng.lognormal(mean=11.0, sigma=0.8, size=n_samples)
    transaction_volume = np.clip(transaction_volume, 10_000, 500_000)

    # Data quality score (0-100)
    data_quality = rng.uniform(40, 100, size=n_samples)

    # Number of data sources
    num_sources = rng.integers(2, 8, size=n_samples)

    # Days since last reconciliation
    days_since_last = rng.integers(1, 90, size=n_samples)

    # Automation level (0-100%)
    automation_level = rng.uniform(10, 95, size=n_samples)

    # Number of accounts
    num_accounts = rng.integers(3, 50, size=n_samples)

    # Error rate from previous period (%)
    prev_error_rate = rng.exponential(3, size=n_samples)
    prev_error_rate = np.clip(prev_error_rate, 0.1, 30)

    # ── TARGET: matchedTransactions ──
    match_rate = (
        0.70
        + data_quality / 100 * 0.20
        + automation_level / 100 * 0.10
        - prev_error_rate / 100 * 0.15
        - days_since_last / 90 * 0.05
        + rng.normal(0, 0.03, size=n_samples)
    )
    match_rate = np.clip(match_rate, 0.50, 0.995)
    matched = np.round(total_transactions * match_rate).astype(int)
    matched = np.clip(matched, 1, total_transactions)

    # ── TARGET: unmatchedTransactions ──
    unmatched = total_transactions - matched

    # ── TARGET: reconciliationStatus ──
    statuses = []
    for i in range(n_samples):
        mr = matched[i] / max(total_transactions[i], 1)
        if mr >= 0.95 and prev_error_rate[i] < 5:
            s = "successful"
        elif mr < 0.80 or prev_error_rate[i] > 15:
            s = "failed"
        else:
            s = "partial"
        if rng.random() < 0.08:
            alts = [x for x in ["successful", "partial", "failed"] if x != s]
            s = rng.choice(alts)
        statuses.append(s)

    df = pd.DataFrame({
        "companyName": [f"Company {i+1}" for i in range(n_samples)],
        "industry": industries,
        "totalTransactions": total_transactions,
        "transactionVolume": np.round(transaction_volume, 2),
        "dataQuality": np.round(data_quality, 2),
        "numSources": num_sources,
        "daysSinceLastRecon": days_since_last,
        "automationLevel": np.round(automation_level, 2),
        "numAccounts": num_accounts,
        "prevErrorRate": np.round(prev_error_rate, 2),
        "matchedTransactions": matched,
        "unmatchedTransactions": unmatched,
        "reconciliationStatus": statuses,
    })
    return df


def main():
    print("=" * 60)
    print("  Reconciliation Agent - Synthetic Dataset Generator")
    print("=" * 60)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset()
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nDataset: {OUTPUT_FILE} ({df.shape[0]} rows)")
    print(f"\n-- Status Distribution --")
    print(df["reconciliationStatus"].value_counts().to_string())

if __name__ == "__main__":
    main()
