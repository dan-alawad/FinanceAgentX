"""
=============================================================================
  Credit Agent - Inference Script
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
            "le_risk": joblib.load(os.path.join(MODEL_DIR, "label_encoder_risk.joblib")),
            "le_elig": joblib.load(os.path.join(MODEL_DIR, "label_encoder_elig.joblib")),
            "score_model": joblib.load(os.path.join(MODEL_DIR, "credit_score_model.joblib")),
            "risk_model": joblib.load(os.path.join(MODEL_DIR, "risk_level_model.joblib")),
            "elig_model": joblib.load(os.path.join(MODEL_DIR, "loan_eligibility_model.joblib")),
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

    score = int(np.clip(round(models["score_model"].predict(X)[0]), 300, 850))
    risk_enc = models["risk_model"].predict(X)[0]
    risk_level = models["le_risk"].inverse_transform([int(risk_enc)])[0]
    elig_enc = models["elig_model"].predict(X)[0]
    loan_elig = models["le_elig"].inverse_transform([int(elig_enc)])[0]

    return {
        "agent": "credit",
        "status": "completed",
        "processedData": {
            "company": company,
            "creditScore": score,
            "riskLevel": risk_level,
            "loanEligibility": loan_elig
        }
    }

def main():
    if len(sys.argv) > 1:
        try: input_data = json.loads(sys.argv[1])
        except json.JSONDecodeError: print(json.dumps({"error": "Invalid JSON"})); sys.exit(1)
    else:
        print("=" * 60)
        print("  Credit Agent - Inference Demo")
        print("=" * 60)
        input_data = {
            "companyName": "ABC Corporation", "industry": "technology",
            "revenue": 150000, "debtToEquity": 0.8, "yearsInBusiness": 15,
            "paymentHistory": 92.0, "outstandingDebt": 75000,
            "creditUtilization": 35.0, "latePayments": 1,
            "collateralValue": 300000, "annualGrowth": 12.0
        }
        print("\nSample Input:")
        print(json.dumps(input_data, indent=2))

    result = predict(input_data)
    print("\nPrediction Output:")
    print(json.dumps(result, indent=2))
    return result

if __name__ == "__main__":
    main()
