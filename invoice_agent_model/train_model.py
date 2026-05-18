"""
=============================================================================
  Invoice Agent - Model Training Pipeline
=============================================================================
  Trains models for the Invoice Agent:
    - invoiceAmount   -> Regression (XGBoost / RF / Linear)
    - paymentStatus   -> Classification (approved/pending/rejected)
    - duplicateCheck  -> Binary Classification (True/False)

  Usage:  python train_model.py
  Output: saved_models/ directory with all model artifacts
=============================================================================
"""

import os, json, warnings, numpy as np, pandas as pd, joblib
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder, OrdinalEncoder
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import (mean_absolute_error, mean_squared_error, r2_score,
                             accuracy_score, classification_report)
from xgboost import XGBRegressor, XGBClassifier

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "training_data.csv")
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")

NUMERIC_FEATURES = ["revenue", "invoiceAmount", "vendorHistoryMonths", "lineItems",
                    "daysSinceReceived", "previousInvoices", "amountDeviation", "hasPurchaseOrder"]
CATEGORICAL_FEATURES = ["industry", "invoiceCategory"]


def build_preprocessor():
    return ColumnTransformer(transformers=[
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), CATEGORICAL_FEATURES),
    ], remainder="drop")


def eval_regressor(name, model, X_test, y_test):
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)
    print(f"  {name:25s}  MAE=${mae:>10,.0f}  RMSE=${rmse:>10,.0f}  R2={r2:.4f}")
    return {"model_name": name, "mae": round(mae, 2), "rmse": round(rmse, 2), "r2": round(r2, 4)}


def eval_classifier(name, model, X_test, y_test, le):
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    pred_labels = le.inverse_transform(preds.astype(int))
    true_labels = le.inverse_transform(y_test.astype(int))
    print(f"  {name:25s}  Accuracy={acc:.4f}")
    print(classification_report(true_labels, pred_labels, zero_division=0))
    return {"model_name": name, "accuracy": round(acc, 4)}


def train():
    print("=" * 65)
    print("  Invoice Agent - Model Training Pipeline")
    print("=" * 65)

    if not os.path.exists(DATA_FILE):
        print(f"ERROR: {DATA_FILE} not found. Run generate_dataset.py first.")
        return

    df = pd.read_csv(DATA_FILE)
    print(f"\nLoaded {len(df)} records")

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]

    # Targets
    y_amount = df["invoiceAmount"]

    le_status = LabelEncoder()
    y_status = le_status.fit_transform(df["paymentStatus"])

    le_dup = LabelEncoder()
    y_dup = le_dup.fit_transform(df["duplicateCheck"])

    # Split
    X_train, X_test, ya_train, ya_test = train_test_split(X, y_amount, test_size=0.2, random_state=42)
    _, _, ys_train, ys_test = train_test_split(X, y_status, test_size=0.2, random_state=42)
    _, _, yd_train, yd_test = train_test_split(X, y_dup, test_size=0.2, random_state=42)

    preprocessor = build_preprocessor()
    X_train_p = preprocessor.fit_transform(X_train)
    X_test_p = preprocessor.transform(X_test)

    # ── invoiceAmount (Regression) ──
    print(f"\n{'-' * 65}")
    print(f"  TARGET: invoiceAmount (Regression)")
    print(f"{'-' * 65}")
    amt_models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
        "XGBoost": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0),
    }
    amt_results, amt_trained = [], {}
    for name, m in amt_models.items():
        m.fit(X_train_p, ya_train)
        r = eval_regressor(name, m, X_test_p, ya_test)
        amt_results.append(r); amt_trained[name] = m
    best_amt = max(amt_results, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_amt['model_name']} (R2={best_amt['r2']})")

    # ── paymentStatus (Classification) ──
    print(f"\n{'-' * 65}")
    print(f"  TARGET: paymentStatus (Classification)")
    print(f"{'-' * 65}")
    stat_models = {
        "Logistic Regression": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
        "Random Forest": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced"),
        "XGBoost": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="mlogloss"),
    }
    stat_results, stat_trained = [], {}
    for name, m in stat_models.items():
        m.fit(X_train_p, ys_train)
        r = eval_classifier(name, m, X_test_p, ys_test, le_status)
        stat_results.append(r); stat_trained[name] = m
    best_stat = max(stat_results, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_stat['model_name']} (Acc={best_stat['accuracy']})")

    # ── duplicateCheck (Binary Classification) ──
    print(f"\n{'-' * 65}")
    print(f"  TARGET: duplicateCheck (Binary Classification)")
    print(f"{'-' * 65}")
    dup_models = {
        "Logistic Regression": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
        "Random Forest": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced"),
        "XGBoost": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="logloss"),
    }
    dup_results, dup_trained = [], {}
    for name, m in dup_models.items():
        m.fit(X_train_p, yd_train)
        r = eval_classifier(name, m, X_test_p, yd_test, le_dup)
        dup_results.append(r); dup_trained[name] = m
    best_dup = max(dup_results, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_dup['model_name']} (Acc={best_dup['accuracy']})")

    # ── Save ──
    print(f"\n{'-' * 65}")
    print(f"  Saving models...")
    print(f"{'-' * 65}")
    os.makedirs(MODEL_DIR, exist_ok=True)

    joblib.dump(preprocessor, os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib"))
    joblib.dump(le_status, os.path.join(MODEL_DIR, "label_encoder_status.joblib"))
    joblib.dump(le_dup, os.path.join(MODEL_DIR, "label_encoder_dup.joblib"))
    joblib.dump(amt_trained[best_amt["model_name"]], os.path.join(MODEL_DIR, "invoice_amount_model.joblib"))
    joblib.dump(stat_trained[best_stat["model_name"]], os.path.join(MODEL_DIR, "payment_status_model.joblib"))
    joblib.dump(dup_trained[best_dup["model_name"]], os.path.join(MODEL_DIR, "duplicate_check_model.joblib"))

    metadata = {
        "trained_at": datetime.now().isoformat(),
        "dataset_size": len(df),
        "feature_columns": feature_cols,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "status_classes": le_status.classes_.tolist(),
        "dup_classes": le_dup.classes_.tolist(),
        "best_models": {
            "invoiceAmount": best_amt,
            "paymentStatus": best_stat,
            "duplicateCheck": best_dup,
        }
    }
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n{'=' * 65}")
    print(f"  Training complete! All models saved to {MODEL_DIR}")
    print(f"{'=' * 65}")


if __name__ == "__main__":
    train()
