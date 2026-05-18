"""
=============================================================================
  Budget Agent - Inference Script
=============================================================================
"""

import os, sys, json, numpy as np, pandas as pd, joblib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")

ALL_DEPARTMENTS = ["Marketing", "Operations", "IT", "HR", "Finance", "Sales", "R&D"]

_cache = None
def get_models():
    global _cache
    if _cache is None:
        _cache = {
            "preprocessor": joblib.load(os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib")),
            "le_dept": joblib.load(os.path.join(MODEL_DIR, "label_encoder_dept.joblib")),
            "total_model": joblib.load(os.path.join(MODEL_DIR, "total_budget_model.joblib")),
            "remaining_model": joblib.load(os.path.join(MODEL_DIR, "remaining_budget_model.joblib")),
            "dept_model": joblib.load(os.path.join(MODEL_DIR, "approved_depts_model.joblib")),
        }
        with open(os.path.join(MODEL_DIR, "model_metadata.json"), "r") as f:
            _cache["metadata"] = json.load(f)
    return _cache

def format_currency(value):
    return f"${int(round(value)):,}"

def predict(input_data: dict) -> dict:
    models = get_models()
    meta = models["metadata"]
    company = input_data.get("companyName", "Unknown")

    row = {col: input_data.get(col, 0) for col in meta["feature_columns"]}
    df = pd.DataFrame([row])
    X = models["preprocessor"].transform(df)

    total = max(0, models["total_model"].predict(X)[0])
    remaining = max(0, models["remaining_model"].predict(X)[0])
    remaining = min(remaining, total * 0.95)  # cap at 95% of total

    dept_enc = models["dept_model"].predict(X)[0]
    n_approved = int(models["le_dept"].inverse_transform([int(dept_enc)])[0])
    n_approved = max(1, min(n_approved, len(ALL_DEPARTMENTS)))

    # Select department names based on count
    import hashlib
    seed_val = int(hashlib.md5(company.encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed_val)
    approved_list = rng.choice(ALL_DEPARTMENTS, size=n_approved, replace=False).tolist()

    return {
        "agent": "budget",
        "status": "completed",
        "processedData": {
            "company": company,
            "totalBudget": format_currency(total),
            "approvedDepartments": approved_list,
            "remainingBudget": format_currency(remaining)
        }
    }

def main():
    if len(sys.argv) > 1:
        try: input_data = json.loads(sys.argv[1])
        except json.JSONDecodeError: print(json.dumps({"error": "Invalid JSON"})); sys.exit(1)
    else:
        print("=" * 60)
        print("  Budget Agent - Inference Demo")
        print("=" * 60)
        input_data = {
            "companyName": "ABC Corporation", "industry": "technology",
            "revenue": 150000, "numDepartments": 5, "fiscalQuarter": 2,
            "yoyGrowth": 8.5, "operatingMargin": 22.0, "headcount": 120,
            "prevUtilization": 78.5
        }
        print("\nSample Input:")
        print(json.dumps(input_data, indent=2))

    result = predict(input_data)
    print("\nPrediction Output:")
    print(json.dumps(result, indent=2))
    return result

if __name__ == "__main__":
    main()
