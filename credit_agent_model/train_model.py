"""
=============================================================================
  Credit Agent - Model Training Pipeline
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

NUMERIC_FEATURES = ["revenue", "debtToEquity", "yearsInBusiness", "paymentHistory",
                    "outstandingDebt", "creditUtilization", "latePayments",
                    "collateralValue", "annualGrowth"]
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
    print("  Credit Agent - Model Training Pipeline")
    print("=" * 65)

    if not os.path.exists(DATA_FILE):
        print("ERROR: Run generate_dataset.py first."); return

    df = pd.read_csv(DATA_FILE)
    print(f"\nLoaded {len(df)} records")

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    X = df[feature_cols]
    y_score = df["creditScore"]
    le_risk = LabelEncoder(); y_risk = le_risk.fit_transform(df["riskLevel"])
    le_elig = LabelEncoder(); y_elig = le_elig.fit_transform(df["loanEligibility"])

    X_tr, X_te, ysc_tr, ysc_te = train_test_split(X, y_score, test_size=0.2, random_state=42)
    _, _, yr_tr, yr_te = train_test_split(X, y_risk, test_size=0.2, random_state=42)
    _, _, ye_tr, ye_te = train_test_split(X, y_elig, test_size=0.2, random_state=42)

    pp = build_preprocessor()
    X_tr_p = pp.fit_transform(X_tr); X_te_p = pp.transform(X_te)

    # creditScore
    print(f"\n{'-'*65}\n  TARGET: creditScore (Regression)\n{'-'*65}")
    ms = {"Linear": LinearRegression(), "RF": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
          "XGB": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0)}
    rs, ts = [], {}
    for n,m in ms.items(): m.fit(X_tr_p, ysc_tr); r=eval_reg(n,m,X_te_p,ysc_te); rs.append(r); ts[n]=m
    best_sc = max(rs, key=lambda x: x["r2"])
    print(f"\n  >> Best: {best_sc['model_name']} (R2={best_sc['r2']})")

    # riskLevel
    print(f"\n{'-'*65}\n  TARGET: riskLevel (Classification)\n{'-'*65}")
    mr = {"Logistic": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
          "RF": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced"),
          "XGB": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="mlogloss")}
    rr, tr = [], {}
    for n,m in mr.items(): m.fit(X_tr_p, yr_tr); r=eval_cls(n,m,X_te_p,yr_te,le_risk); rr.append(r); tr[n]=m
    best_risk = max(rr, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_risk['model_name']} (Acc={best_risk['accuracy']})")

    # loanEligibility
    print(f"\n{'-'*65}\n  TARGET: loanEligibility (Classification)\n{'-'*65}")
    me = {"Logistic": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
          "RF": RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced"),
          "XGB": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42, verbosity=0, eval_metric="mlogloss")}
    re, te = [], {}
    for n,m in me.items(): m.fit(X_tr_p, ye_tr); r=eval_cls(n,m,X_te_p,ye_te,le_elig); re.append(r); te[n]=m
    best_elig = max(re, key=lambda x: x["accuracy"])
    print(f"\n  >> Best: {best_elig['model_name']} (Acc={best_elig['accuracy']})")

    # Save
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(pp, os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib"))
    joblib.dump(le_risk, os.path.join(MODEL_DIR, "label_encoder_risk.joblib"))
    joblib.dump(le_elig, os.path.join(MODEL_DIR, "label_encoder_elig.joblib"))
    joblib.dump(ts[best_sc["model_name"]], os.path.join(MODEL_DIR, "credit_score_model.joblib"))
    joblib.dump(tr[best_risk["model_name"]], os.path.join(MODEL_DIR, "risk_level_model.joblib"))
    joblib.dump(te[best_elig["model_name"]], os.path.join(MODEL_DIR, "loan_eligibility_model.joblib"))

    meta = {"trained_at": datetime.now().isoformat(), "dataset_size": len(df),
            "feature_columns": feature_cols, "risk_classes": le_risk.classes_.tolist(),
            "elig_classes": le_elig.classes_.tolist(),
            "best_models": {"creditScore": best_sc, "riskLevel": best_risk, "loanEligibility": best_elig}}
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n{'='*65}\n  Training complete! Models saved to {MODEL_DIR}\n{'='*65}")

if __name__ == "__main__":
    train()
