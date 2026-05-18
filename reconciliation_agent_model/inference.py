"""
=============================================================================
  Reconciliation Agent - Inference Script
=============================================================================
"""

import os, sys, json, numpy as np, pandas as pd, joblib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")

_cache = None
def get_models():
    global _cache
    if _cache is None:
        _cache = {
            "pp": joblib.load(os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib")),
            "le": joblib.load(os.path.join(MODEL_DIR, "label_encoder_status.joblib")),
            "matched": joblib.load(os.path.join(MODEL_DIR, "matched_model.joblib")),
            "unmatched": joblib.load(os.path.join(MODEL_DIR, "unmatched_model.joblib")),
            "status": joblib.load(os.path.join(MODEL_DIR, "status_model.joblib")),
        }
        with open(os.path.join(MODEL_DIR, "model_metadata.json"), "r") as f:
            _cache["meta"] = json.load(f)
    return _cache

def predict(input_data: dict) -> dict:
    models = get_models()
    meta = models["meta"]
    company = input_data.get("companyName", "Unknown")

    row = {col: input_data.get(col, 0) for col in meta["feature_columns"]}
    df = pd.DataFrame([row])
    X = models["pp"].transform(df)

    matched = max(0, int(round(models["matched"].predict(X)[0])))
    unmatched = max(0, int(round(models["unmatched"].predict(X)[0])))
    status_enc = models["status"].predict(X)[0]
    status = models["le"].inverse_transform([int(status_enc)])[0]

    return {
        "agent": "reconciliation",
        "status": "completed",
        "processedData": {
            "company": company,
            "matchedTransactions": matched,
            "unmatchedTransactions": unmatched,
            "reconciliationStatus": status
        }
    }

def main():
    if len(sys.argv) > 1:
        try: input_data = json.loads(sys.argv[1])
        except json.JSONDecodeError: print(json.dumps({"error": "Invalid JSON"})); sys.exit(1)
    else:
        print("=" * 60)
        print("  Reconciliation Agent - Inference Demo")
        print("=" * 60)
        input_data = {
            "companyName": "ABC Corporation", "industry": "technology",
            "totalTransactions": 150, "transactionVolume": 200000,
            "dataQuality": 88.5, "numSources": 4,
            "daysSinceLastRecon": 14, "automationLevel": 75.0,
            "numAccounts": 12, "prevErrorRate": 2.5
        }
        print("\nSample Input:")
        print(json.dumps(input_data, indent=2))

    result = predict(input_data)
    print("\nPrediction Output:")
    print(json.dumps(result, indent=2))
    return result

if __name__ == "__main__":
    main()
