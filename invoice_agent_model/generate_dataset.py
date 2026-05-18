"""
=============================================================================
  Invoice Agent - Synthetic Dataset Generator
=============================================================================
  Generates realistic invoice processing data for training.

  Targets:
    - invoiceAmount     (float, dollars)
    - paymentStatus     (str: "approved", "pending", "rejected")
    - duplicateCheck    (bool: True/False)

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

INVOICE_CATEGORIES = ["services", "supplies", "equipment", "consulting", "maintenance"]


def generate_dataset(n_samples=NUM_SAMPLES, seed=SEED):
    """Generate synthetic invoice processing dataset."""
    rng = np.random.default_rng(seed)

    industries = rng.choice(INDUSTRIES, size=n_samples, p=INDUSTRY_WEIGHTS)
    categories = rng.choice(INVOICE_CATEGORIES, size=n_samples)

    # Revenue context (determines invoice scale)
    revenue = rng.lognormal(mean=11.0, sigma=0.8, size=n_samples)
    revenue = np.clip(revenue, 10_000, 500_000)

    # Invoice amount: fraction of monthly revenue
    invoice_ratio = rng.uniform(0.02, 0.25, size=n_samples)
    invoice_amount = revenue * invoice_ratio
    invoice_amount = np.clip(invoice_amount, 500, 120_000)

    # Vendor history (months of relationship)
    vendor_history_months = rng.integers(1, 120, size=n_samples)

    # Number of line items
    line_items = rng.integers(1, 25, size=n_samples)

    # Days since invoice received
    days_since_received = rng.integers(0, 90, size=n_samples)

    # Previous invoices from this vendor
    previous_invoices = rng.integers(0, 200, size=n_samples)

    # Amount deviation from historical average (%)
    amount_deviation = rng.normal(0, 15, size=n_samples)

    # Has purchase order
    has_purchase_order = rng.choice([0, 1], size=n_samples, p=[0.2, 0.8])

    # Company names
    prefixes = ["Alpha", "Beta", "Gamma", "Delta", "Omega", "Nova", "Apex",
                "Prime", "Core", "Peak", "Zen", "Flux", "Nexus", "Vertex"]
    suffixes = ["Corp", "Inc", "LLC", "Group", "Holdings", "Solutions", "Tech"]
    company_names = [f"{rng.choice(prefixes)} {rng.choice(suffixes)} {i+1}" for i in range(n_samples)]

    # ── TARGET 1: paymentStatus ──
    payment_status = []
    for i in range(n_samples):
        score = 0.0
        score += 0.3 if has_purchase_order[i] else -0.2
        score += 0.2 if vendor_history_months[i] > 12 else -0.1
        score += 0.2 if abs(amount_deviation[i]) < 10 else -0.15
        score += -0.3 if days_since_received[i] > 60 else 0.1
        score += -0.2 if invoice_amount[i] > 80000 else 0.1
        score += rng.normal(0, 0.15)

        if score > 0.2:
            status = "approved"
        elif score < -0.15:
            status = "rejected"
        else:
            status = "pending"

        # 8% noise
        if rng.random() < 0.08:
            alts = [s for s in ["approved", "pending", "rejected"] if s != status]
            status = rng.choice(alts)
        payment_status.append(status)

    # ── TARGET 2: duplicateCheck ──
    duplicate_check = []
    for i in range(n_samples):
        dup_prob = 0.05  # base 5% duplicate rate
        if abs(amount_deviation[i]) < 2:
            dup_prob += 0.15  # same amount = more likely dup
        if days_since_received[i] < 7:
            dup_prob += 0.10  # recent = more likely dup
        if previous_invoices[i] > 100:
            dup_prob += 0.05  # high volume = more dups
        duplicate_check.append(rng.random() < dup_prob)

    df = pd.DataFrame({
        "companyName": company_names, "industry": industries,
        "invoiceCategory": categories, "revenue": np.round(revenue, 2),
        "invoiceAmount": np.round(invoice_amount, 2),
        "vendorHistoryMonths": vendor_history_months,
        "lineItems": line_items,
        "daysSinceReceived": days_since_received,
        "previousInvoices": previous_invoices,
        "amountDeviation": np.round(amount_deviation, 2),
        "hasPurchaseOrder": has_purchase_order,
        "paymentStatus": payment_status,
        "duplicateCheck": duplicate_check,
    })
    return df


def main():
    print("=" * 60)
    print("  Invoice Agent - Synthetic Dataset Generator")
    print("=" * 60)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset()
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nDataset generated: {OUTPUT_FILE}")
    print(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns")
    print(f"\n-- Payment Status Distribution --")
    print(df["paymentStatus"].value_counts().to_string())
    print(f"\n-- Duplicate Check Distribution --")
    print(df["duplicateCheck"].value_counts().to_string())
    print(f"\n-- Sample Rows --")
    print(df.head(3).to_string())


if __name__ == "__main__":
    main()
