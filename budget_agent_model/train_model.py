"""
=============================================================================
  Budget Agent - Model Training Pipeline
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

NUMERIC_FEATURES = ["revenue", "numDepartments", "fiscalQuarter", "yoyGrowth",
                    "operatingMargin", "headcount", "prevUtilization"]
CATEGORICAL_FEATURES = ["industry"]

def build_preprocessor():
    return ColumnTransformer(transformers=[
        ("num", StandardScaler(), NUMERIC_FEATURES),
        ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), CATEGORICAL_FEATURES),
    ], remainder="drop")

def eval_reg(name, model, X_test, y_test):
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)
    print(f"  {name:25s}  MAE=${mae:>10,.0f}  RMSE=${rmse:>10,.0f}  R2={r2:.4f}")
    return {"model_name": name, "mae": round(mae, 2), "rmse": round(rmse, 2), "r2": round(r2, 4)}

def eval_cls(name, model, X_test, y_test, le):
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    print(f"  {name:25s}  Accuracy={acc:.4f}")
    return {"model_name": name, "accuracy": round(acc, 4)}

def train():
    print("=" * 65)
    print("  Budget Agent - Model Training Pipeline")
    print("=" * 65)

    if not os.path.exists(DATA_FILE):
        print(f"ERROR: {DATA_FILE} not found. Run generate_dataset.py first."); return

    df = pd.read_csv(DATA_FILE)
    print(f"\nLoaded {len(df)} records")

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y_total = df["totalBudget"]
    y_remaining = df["remainingBudget"]

    le_dept = LabelEncoder()
    y_dept = le_dept.fit_transform(df["approvedDepartments"])

    X_train, X_test, yt_train, yt_test = train_test_split(X, y_total, test_size=0.2, random_state=42)
    _, _, yr_train, yr_test = train_test_split(X, y_remaining, test_size=0.2, random_state=42)
    _, _, yd_train, yd_test = train_test_split(X, y_dept, test_size=0.2, random_state=42)

    preprocessor = build_preprocessor()
    X_train_p = preprocessor.fit_transform(X_train)
    X_test_p = preprocessor.transform(X_test)

    # totalBudget
    print(f"\n{'-'*65}\n  TARGET: totalBudget (Regression)\n{'-'*65}")
    t_models = {"Linear": LinearRegression(), "Random Forest": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
                "XGBoost": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0)}
    t_res, t_tr = [], {}
    for n, m in t_models.items():
        m.fit(X_train_p, yt_train); r = eval_reg(n, m, X_test_p, yt_test); t_res.append(r); t_tr[n] = m
    best_t = max(t_res, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_t['model_name']} (R2={best_t['r2']})")

    # remainingBudget
    print(f"\n{'-'*65}\n  TARGET: remainingBudget (Regression)\n{'-'*65}")
    r_models = {"Linear": LinearRegression(), "Random Forest": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
                "XGBoost": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0)}
    r_res, r_tr = [], {}
    for n, m in r_models.items():
        m.fit(X_train_p, yr_train); r = eval_reg(n, m, X_test_p, yr_test); r_res.append(r); r_tr[n] = m
    best_r = max(r_res, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_r['model_name']} (R2={best_r['r2']})")

    # approvedDepartments
    print(f"\n{'-'*65}\n  TARGET: approvedDepartments (Classification)\n{'-'*65}")
    d_models = {"Logistic": LogisticRegression(max_iter=1000, random_state=42),
                "Random Forest": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42),
                "XGBoost": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="mlogloss")}
    d_res, d_tr = [], {}
    for n, m in d_models.items():
        m.fit(X_train_p, yd_train); r = eval_cls(n, m, X_test_p, yd_test, le_dept); d_res.append(r); d_tr[n] = m
    best_d = max(d_res, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_d['model_name']} (Acc={best_d['accuracy']})")

    # Save
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(preprocessor, os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib"))
    joblib.dump(le_dept, os.path.join(MODEL_DIR, "label_encoder_dept.joblib"))
    joblib.dump(t_tr[best_t["model_name"]], os.path.join(MODEL_DIR, "total_budget_model.joblib"))
    joblib.dump(r_tr[best_r["model_name"]], os.path.join(MODEL_DIR, "remaining_budget_model.joblib"))
    joblib.dump(d_tr[best_d["model_name"]], os.path.join(MODEL_DIR, "approved_depts_model.joblib"))

    metadata = {"trained_at": datetime.now().isoformat(), "dataset_size": len(df),
                "feature_columns": feature_cols, "numeric_features": NUMERIC_FEATURES,
                "categorical_features": CATEGORICAL_FEATURES,
                "dept_classes": le_dept.classes_.tolist(),
                "best_models": {"totalBudget": best_t, "remainingBudget": best_r, "approvedDepartments": best_d}}
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n{'='*65}\n  Training complete! Models saved to {MODEL_DIR}\n{'='*65}")

if __name__ == "__main__":
    train()
