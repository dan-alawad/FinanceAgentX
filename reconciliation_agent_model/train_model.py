"""
=============================================================================
  Reconciliation Agent - Model Training Pipeline
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

NUMERIC_FEATURES = ["totalTransactions", "transactionVolume", "dataQuality",
                    "numSources", "daysSinceLastRecon", "automationLevel",
                    "numAccounts", "prevErrorRate"]
CATEGORICAL_FEATURES = ["industry"]

def build_preprocessor():
    return ColumnTransformer(transformers=[
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), CATEGORICAL_FEATURES),
    ], remainder="drop")

def eval_reg(name, model, X_t, y_t):
    p = model.predict(X_t)
    mae = mean_absolute_error(y_t, p); rmse = np.sqrt(mean_squared_error(y_t, p)); r2 = r2_score(y_t, p)
    print(f"  {name:25s}  MAE={mae:>8,.1f}  RMSE={rmse:>8,.1f}  R2={r2:.4f}")
    return {"model_name": name, "mae": round(mae,2), "rmse": round(rmse,2), "r2": round(r2,4)}

def eval_cls(name, model, X_t, y_t, le):
    p = model.predict(X_t); acc = accuracy_score(y_t, p)
    pred_l = le.inverse_transform(p.astype(int)); true_l = le.inverse_transform(y_t.astype(int))
    print(f"  {name:25s}  Accuracy={acc:.4f}")
    print(classification_report(true_l, pred_l, zero_division=0))
    return {"model_name": name, "accuracy": round(acc,4)}

def train():
    print("=" * 65)
    print("  Reconciliation Agent - Model Training Pipeline")
    print("=" * 65)

    if not os.path.exists(DATA_FILE):
        print("ERROR: Run generate_dataset.py first."); return

    df = pd.read_csv(DATA_FILE)
    print(f"\nLoaded {len(df)} records")

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y_matched = df["matchedTransactions"]
    y_unmatched = df["unmatchedTransactions"]
    le_status = LabelEncoder()
    y_status = le_status.fit_transform(df["reconciliationStatus"])

    X_tr, X_te, ym_tr, ym_te = train_test_split(X, y_matched, test_size=0.2, random_state=42)
    _, _, yu_tr, yu_te = train_test_split(X, y_unmatched, test_size=0.2, random_state=42)
    _, _, ys_tr, ys_te = train_test_split(X, y_status, test_size=0.2, random_state=42)

    pp = build_preprocessor()
    X_tr_p = pp.fit_transform(X_tr); X_te_p = pp.transform(X_te)

    # matched
    print(f"\n{'-'*65}\n  TARGET: matchedTransactions (Regression)\n{'-'*65}")
    models_m = {"Linear": LinearRegression(), "RF": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
                "XGB": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0)}
    res_m, tr_m = [], {}
    for n,m in models_m.items(): m.fit(X_tr_p, ym_tr); r=eval_reg(n,m,X_te_p,ym_te); res_m.append(r); tr_m[n]=m
    best_m = max(res_m, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_m['model_name']} (R2={best_m['r2']})")

    # unmatched
    print(f"\n{'-'*65}\n  TARGET: unmatchedTransactions (Regression)\n{'-'*65}")
    models_u = {"Linear": LinearRegression(), "RF": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
                "XGB": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0)}
    res_u, tr_u = [], {}
    for n,m in models_u.items(): m.fit(X_tr_p, yu_tr); r=eval_reg(n,m,X_te_p,yu_te); res_u.append(r); tr_u[n]=m
    best_u = max(res_u, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_u['model_name']} (R2={best_u['r2']})")

    # status
    print(f"\n{'-'*65}\n  TARGET: reconciliationStatus (Classification)\n{'-'*65}")
    models_s = {"Logistic": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
                "RF": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced"),
                "XGB": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="mlogloss")}
    res_s, tr_s = [], {}
    for n,m in models_s.items(): m.fit(X_tr_p, ys_tr); r=eval_cls(n,m,X_te_p,ys_te,le_status); res_s.append(r); tr_s[n]=m
    best_s = max(res_s, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_s['model_name']} (Acc={best_s['accuracy']})")

    # Save
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(pp, os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib"))
    joblib.dump(le_status, os.path.join(MODEL_DIR, "label_encoder_status.joblib"))
    joblib.dump(tr_m[best_m["model_name"]], os.path.join(MODEL_DIR, "matched_model.joblib"))
    joblib.dump(tr_u[best_u["model_name"]], os.path.join(MODEL_DIR, "unmatched_model.joblib"))
    joblib.dump(tr_s[best_s["model_name"]], os.path.join(MODEL_DIR, "status_model.joblib"))

    meta = {"trained_at": datetime.now().isoformat(), "dataset_size": len(df),
            "feature_columns": feature_cols, "status_classes": le_status.classes_.tolist(),
            "best_models": {"matched": best_m, "unmatched": best_u, "status": best_s}}
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n{'='*65}\n  Training complete! Models saved to {MODEL_DIR}\n{'='*65}")

if __name__ == "__main__":
    train()
