"""
=============================================================================
  Invoice Agent - Inference Script
=============================================================================
  Loads trained models and predicts invoiceAmount, paymentStatus, duplicateCheck.

  Usage:
    python inference.py                          # demo mode
    python inference.py '{"revenue":150000,...}'  # with input JSON
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
            "preprocessor": joblib.load(os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib")),
            "le_status": joblib.load(os.path.join(MODEL_DIR, "label_encoder_status.joblib")),
            "le_dup": joblib.load(os.path.join(MODEL_DIR, "label_encoder_dup.joblib")),
            "amount_model": joblib.load(os.path.join(MODEL_DIR, "invoice_amount_model.joblib")),
            "status_model": joblib.load(os.path.join(MODEL_DIR, "payment_status_model.joblib")),
            "dup_model": joblib.load(os.path.join(MODEL_DIR, "duplicate_check_model.joblib")),
        }
        with open(os.path.join(MODEL_DIR, "model_metadata.json"), "r") as f:
            _cache["metadata"] = json.load(f)
    return _cache


def predict(input_data: dict) -> dict:
    """Run Invoice Agent prediction."""
    models = get_models()
    meta = models["metadata"]
    company = input_data.get("companyName", "Unknown")

    row = {col: input_data.get(col, 0) for col in meta["feature_columns"]}
    df = pd.DataFrame([row])
    X = models["preprocessor"].transform(df)

    # Predict
    amount = max(0, models["amount_model"].predict(X)[0])
    status_enc = models["status_model"].predict(X)[0]
    payment_status = models["le_status"].inverse_transform([int(status_enc)])[0]
    dup_enc = models["dup_model"].predict(X)[0]
    duplicate_check = bool(models["le_dup"].inverse_transform([int(dup_enc)])[0])

    # Generate invoice ID based on amount hash
    inv_num = abs(hash(f"{company}{amount}")) % 900 + 100
    invoice_id = f"INV-2026-{inv_num}"

    # Generate contextual notes
    if duplicate_check:
        notes = "Potential duplicate invoice detected. Manual review recommended."
    elif payment_status == "rejected":
        notes = "Invoice flagged for review. Missing documentation or policy violation."
    elif payment_status == "pending":
        notes = "Invoice requires additional approval before processing."
    else:
        notes = "Invoice records appear valid and no duplicate invoice was detected."

    return {
        "agent": "invoice",
        "status": "completed",
        "processedData": {
            "invoiceId": invoice_id,
            "company": company,
            "invoiceAmount": round(amount, 2),
            "paymentStatus": payment_status,
            "duplicateCheck": duplicate_check,
            "notes": notes
        }
    }


def main():
    if len(sys.argv) > 1:
        try:
            input_data = json.loads(sys.argv[1])
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON"}))
            sys.exit(1)
    else:
        print("=" * 60)
        print("  Invoice Agent - Inference Demo")
        print("=" * 60)
        input_data = {
            "companyName": "ABC Corporation", "industry": "technology",
            "invoiceCategory": "consulting", "revenue": 150000,
            "invoiceAmount": 18500, "vendorHistoryMonths": 36,
            "lineItems": 8, "daysSinceReceived": 5,
            "previousInvoices": 24, "amountDeviation": 3.5,
            "hasPurchaseOrder": 1
        }
        print("\nSample Input:")
        print(json.dumps(input_data, indent=2))

    result = predict(input_data)
    print("\nPrediction Output:")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    main()
