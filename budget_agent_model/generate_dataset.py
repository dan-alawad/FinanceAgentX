"""
=============================================================================
  Budget Agent - Synthetic Dataset Generator
=============================================================================
  Generates realistic budget analysis data for training.

  Targets:
    - totalBudget          (float, dollars)
    - remainingBudget      (float, dollars)
    - approvedDepartments  (int, count of approved departments)

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

ALL_DEPARTMENTS = ["Marketing", "Operations", "IT", "HR", "Finance", "Sales", "R&D"]


def generate_dataset(n_samples=NUM_SAMPLES, seed=SEED):
    """Generate synthetic budget analysis dataset."""
    rng = np.random.default_rng(seed)

    industries = rng.choice(INDUSTRIES, size=n_samples, p=INDUSTRY_WEIGHTS)

    # Revenue context
    revenue = rng.lognormal(mean=11.0, sigma=0.8, size=n_samples)
    revenue = np.clip(revenue, 10_000, 500_000)

    # Number of departments (3-7)
    num_departments = rng.integers(3, 8, size=n_samples)

    # Q1-Q4 quarter
    fiscal_quarter = rng.integers(1, 5, size=n_samples)

    # Year-over-year growth rate (%)
    yoy_growth = rng.normal(5, 12, size=n_samples)

    # Operating margin (%)
    operating_margin = rng.uniform(5, 35, size=n_samples)

    # Headcount
    headcount = rng.integers(10, 500, size=n_samples)

    # Previous period budget utilization (%)
    prev_utilization = rng.uniform(50, 105, size=n_samples)

    # ── TARGET 1: totalBudget ──
    budget_ratio = rng.uniform(0.15, 0.60, size=n_samples)
    industry_mult = np.array([
        {"technology": 1.3, "retail": 0.9, "manufacturing": 1.0,
         "healthcare": 1.1, "services": 0.85}[ind] for ind in industries
    ])
    total_budget = revenue * budget_ratio * industry_mult
    total_budget += headcount * rng.uniform(50, 200, size=n_samples)
    total_budget = np.clip(total_budget, 5000, None)

    # ── TARGET 2: remainingBudget ──
    # Remaining depends on quarter (later = less remaining) and utilization
    quarter_factor = 1.0 - (fiscal_quarter - 1) * 0.22
    remaining_ratio = np.clip(quarter_factor + rng.normal(0, 0.08, size=n_samples), 0.02, 0.85)
    remaining_budget = total_budget * remaining_ratio
    remaining_budget = np.clip(remaining_budget, 500, total_budget * 0.95)

    # ── TARGET 3: approvedDepartments ──
    approved_depts = []
    for i in range(n_samples):
        max_approved = num_departments[i]
        if operating_margin[i] > 20 and yoy_growth[i] > 0:
            n_approved = rng.integers(max(2, max_approved - 1), max_approved + 1)
        elif operating_margin[i] < 10 or yoy_growth[i] < -5:
            n_approved = rng.integers(1, max(2, max_approved - 2) + 1)
        else:
            n_approved = rng.integers(1, max_approved + 1)
        # 8% noise
        if rng.random() < 0.08:
            n_approved = rng.integers(1, max_approved + 1)
        approved_depts.append(int(n_approved))

    df = pd.DataFrame({
        "companyName": [f"Company {i+1}" for i in range(n_samples)],
        "industry": industries,
        "revenue": np.round(revenue, 2),
        "numDepartments": num_departments,
        "fiscalQuarter": fiscal_quarter,
        "yoyGrowth": np.round(yoy_growth, 2),
        "operatingMargin": np.round(operating_margin, 2),
        "headcount": headcount,
        "prevUtilization": np.round(prev_utilization, 2),
        "totalBudget": np.round(total_budget, 2),
        "remainingBudget": np.round(remaining_budget, 2),
        "approvedDepartments": approved_depts,
    })
    return df


def main():
    print("=" * 60)
    print("  Budget Agent - Synthetic Dataset Generator")
    print("=" * 60)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = generate_dataset()
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nDataset generated: {OUTPUT_FILE}")
    print(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns")
    print(df.describe().round(2).to_string())


if __name__ == "__main__":
    main()
