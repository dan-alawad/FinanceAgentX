"""
=============================================================================
  Cash Agent - Inference Script
=============================================================================
  Loads the trained Cash Agent models and predicts:
    - availableCash
    - monthlyExpenses
    - cashFlowStatus

  Can be used:
    1. As a Python module:  from inference import predict
    2. From command line:   python inference.py '{"revenue": 150000, ...}'
    3. Called by Node.js:   child_process.execFile("python", ["inference.py", json])

  Output format matches the required Cash Agent JSON structure.
=============================================================================
"""

import os
import sys
import json
import numpy as np
import pandas as pd
import joblib

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")


def load_models():
    """Load all saved model artifacts from disk."""
    models = {
        "preprocessor": joblib.load(os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib")),
        "label_encoder": joblib.load(os.path.join(MODEL_DIR, "label_encoder.joblib")),
        "cash_model": joblib.load(os.path.join(MODEL_DIR, "cash_available_model.joblib")),
        "expenses_model": joblib.load(os.path.join(MODEL_DIR, "monthly_expenses_model.joblib")),
        "status_model": joblib.load(os.path.join(MODEL_DIR, "cash_flow_classifier.joblib")),
    }

    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "r") as f:
        models["metadata"] = json.load(f)

    return models


# Module-level cache so models are loaded only once
_models_cache = None


def get_models():
    """Get models (loads once, then caches)."""
    global _models_cache
    if _models_cache is None:
        _models_cache = load_models()
    return _models_cache


def add_derived_features(df):
    """Compute derived financial ratios (must match training logic)."""
    df = df.copy()
    df["currentRatio"] = df["currentAssets"] / df["currentLiabilities"].clip(lower=1)
    df["netWorkingCapital"] = df["currentAssets"] - df["currentLiabilities"]
    df["receivablesToRevenueRatio"] = df["accountsReceivable"] / df["revenue"].clip(lower=1)
    df["expenseToRevenueRatio"] = df["totalExpenses"] / df["revenue"].clip(lower=1)
    return df


def format_currency(value):
    """Format a numeric value as a dollar string (e.g., '$85,000')."""
    return f"${int(round(value)):,}"


def predict(input_data: dict) -> dict:
    """
    Run Cash Agent prediction on a single company's financial data.

    Args:
        input_data: Dictionary with keys:
            - companyName (str)
            - revenue (float)
            - totalExpenses (float)
            - accountsReceivable (float)
            - accountsPayable (float)
            - currentAssets (float)
            - currentLiabilities (float)
            - previousCashBalance (float)
            - industry (str)

    Returns:
        Dictionary in the required Cash Agent output format:
        {
            "agent": "cash",
            "status": "completed",
            "processedData": {
                "company": "<company_name>",
                "availableCash": "$85,000",
                "monthlyExpenses": "$23,000",
                "cashFlowStatus": "stable"
            }
        }
    """
    models = get_models()
    metadata = models["metadata"]

    # Build a single-row DataFrame with the expected feature columns
    feature_cols = metadata["feature_columns"]
    company_name = input_data.get("companyName", "Unknown Company")

    # Create DataFrame from input
    row = {col: input_data.get(col, 0) for col in feature_cols}
    df = pd.DataFrame([row])

    # Add derived features
    df = add_derived_features(df)

    # Ensure column order matches training
    df = df[feature_cols]

    # Preprocess
    X = models["preprocessor"].transform(df)

    # Predict
    available_cash = models["cash_model"].predict(X)[0]
    monthly_expenses = models["expenses_model"].predict(X)[0]
    status_encoded = models["status_model"].predict(X)[0]
    cash_flow_status = models["label_encoder"].inverse_transform(
        [int(status_encoded)]
    )[0]

    # Ensure non-negative values
    available_cash = max(available_cash, 0)
    monthly_expenses = max(monthly_expenses, 0)

    # Build output in required format
    result = {
        "agent": "cash",
        "status": "completed",
        "processedData": {
            "company": company_name,
            "availableCash": format_currency(available_cash),
            "monthlyExpenses": format_currency(monthly_expenses),
            "cashFlowStatus": cash_flow_status
        }
    }

    return result


def main():
    """
    CLI entry point. Accepts JSON input as a command-line argument
    or runs a demo with sample data.
    """
    # If JSON argument provided, use it
    if len(sys.argv) > 1:
        try:
            input_data = json.loads(sys.argv[1])
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON input"}))
            sys.exit(1)
    else:
        # Demo with sample input
        print("=" * 60)
        print("  Cash Agent - Inference Demo")
        print("=" * 60)
        print("\nNo input provided, using sample data...\n")

        input_data = {
            "companyName": "ABC Corporation",
            "revenue": 150000,
            "totalExpenses": 95000,
            "accountsReceivable": 45000,
            "accountsPayable": 32000,
            "currentAssets": 280000,
            "currentLiabilities": 120000,
            "previousCashBalance": 90000,
            "industry": "technology"
        }
        print("Sample Input:")
        print(json.dumps(input_data, indent=2))
        print()

    result = predict(input_data)

    print("Prediction Output:")
    print(json.dumps(result, indent=2))

    # Also test with a second sample if in demo mode
    if len(sys.argv) <= 1:
        print("\n" + "-" * 60)
        print("Testing with a struggling company...\n")

        input_data_2 = {
            "companyName": "Struggling Retail Co",
            "revenue": 30000,
            "totalExpenses": 28000,
            "accountsReceivable": 8000,
            "accountsPayable": 15000,
            "currentAssets": 35000,
            "currentLiabilities": 40000,
            "previousCashBalance": 12000,
            "industry": "retail"
        }
        print("Sample Input:")
        print(json.dumps(input_data_2, indent=2))
        print()

        result_2 = predict(input_data_2)
        print("Prediction Output:")
        print(json.dumps(result_2, indent=2))

    return result


if __name__ == "__main__":
    main()
