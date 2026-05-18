"""
=============================================================================
  Cash Agent - Model Training Pipeline
=============================================================================
  Trains and compares multiple ML models for the Cash Agent:
    - availableCash      -> XGBoost / RandomForest / Linear Regression
    - monthlyExpenses    -> XGBoost / RandomForest / Linear Regression
    - cashFlowStatus     -> XGBoost / RandomForest / Logistic Regression

  Usage:  python train_model.py
  Output: saved_models/ directory with all model artifacts
=============================================================================
"""

import os
import json
import warnings
import numpy as np
import pandas as pd
import joblib
from datetime import datetime

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder, OrdinalEncoder
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    accuracy_score, classification_report, confusion_matrix
)

from xgboost import XGBRegressor, XGBClassifier

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "training_data.csv")
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")

# ── Feature definitions ───────────────────────────────────────────────────
NUMERIC_FEATURES = [
    "revenue", "totalExpenses", "accountsReceivable", "accountsPayable",
    "currentAssets", "currentLiabilities", "previousCashBalance"
]
CATEGORICAL_FEATURES = ["industry"]
DERIVED_FEATURES = [
    "currentRatio", "netWorkingCapital",
    "receivablesToRevenueRatio", "expenseToRevenueRatio"
]
TARGET_REGRESSION_1 = "availableCash"
TARGET_REGRESSION_2 = "monthlyExpenses"
TARGET_CLASSIFICATION = "cashFlowStatus"


def add_derived_features(df):
    """Compute derived financial ratios from raw features."""
    df = df.copy()
    df["currentRatio"] = df["currentAssets"] / df["currentLiabilities"].clip(lower=1)
    df["netWorkingCapital"] = df["currentAssets"] - df["currentLiabilities"]
    df["receivablesToRevenueRatio"] = df["accountsReceivable"] / df["revenue"].clip(lower=1)
    df["expenseToRevenueRatio"] = df["totalExpenses"] / df["revenue"].clip(lower=1)
    return df


def build_preprocessor():
    """Build a sklearn ColumnTransformer for numeric + categorical features."""
    all_numeric = NUMERIC_FEATURES + DERIVED_FEATURES
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), all_numeric),
            ("cat", OrdinalEncoder(handle_unknown="use_encoded_value",
                                   unknown_value=-1), CATEGORICAL_FEATURES),
        ],
        remainder="drop"
    )
    return preprocessor


def evaluate_regressor(name, model, X_test, y_test):
    """Evaluate a regression model and return metrics dict."""
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)
    print(f"  {name:25s}  MAE=${mae:>10,.0f}  RMSE=${rmse:>10,.0f}  R2={r2:.4f}")
    return {"model_name": name, "mae": round(mae, 2), "rmse": round(rmse, 2), "r2": round(r2, 4)}


def evaluate_classifier(name, model, X_test, y_test, label_encoder):
    """Evaluate a classification model and return metrics dict."""
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    pred_labels = label_encoder.inverse_transform(preds.astype(int))
    true_labels = label_encoder.inverse_transform(y_test.astype(int))
    print(f"  {name:25s}  Accuracy={acc:.4f}")
    print(classification_report(true_labels, pred_labels, zero_division=0))
    cm = confusion_matrix(true_labels, pred_labels, labels=label_encoder.classes_)
    return {"model_name": name, "accuracy": round(acc, 4),
            "confusion_matrix": cm.tolist()}


def train_and_compare():
    """Main training pipeline: load data, train models, compare, save best."""
    print("=" * 65)
    print("  Cash Agent - Model Training Pipeline")
    print("=" * 65)

    # ── 1. Load data ──────────────────────────────────────────────────
    if not os.path.exists(DATA_FILE):
        print(f"ERROR: Dataset not found at {DATA_FILE}")
        print("Run generate_dataset.py first.")
        return

    df = pd.read_csv(DATA_FILE)
    print(f"\nLoaded {len(df)} records from {DATA_FILE}")

    # ── 2. Feature engineering ────────────────────────────────────────
    df = add_derived_features(df)

    # ── 3. Prepare features and targets ───────────────────────────────
    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES + DERIVED_FEATURES
    X = df[feature_cols]
    y_cash = df[TARGET_REGRESSION_1]
    y_expenses = df[TARGET_REGRESSION_2]

    # Encode classification target
    label_encoder = LabelEncoder()
    y_status = label_encoder.fit_transform(df[TARGET_CLASSIFICATION])
    status_classes = label_encoder.classes_.tolist()
    print(f"Classification classes: {status_classes}")

    # ── 4. Train/test split ───────────────────────────────────────────
    X_train, X_test, y_cash_train, y_cash_test = train_test_split(
        X, y_cash, test_size=0.2, random_state=42)
    _, _, y_exp_train, y_exp_test = train_test_split(
        X, y_expenses, test_size=0.2, random_state=42)
    _, _, y_stat_train, y_stat_test = train_test_split(
        X, y_status, test_size=0.2, random_state=42)

    # ── 5. Fit preprocessor ───────────────────────────────────────────
    preprocessor = build_preprocessor()
    X_train_proc = preprocessor.fit_transform(X_train)
    X_test_proc = preprocessor.transform(X_test)
    print(f"Features after preprocessing: {X_train_proc.shape[1]}")

    # ══════════════════════════════════════════════════════════════════
    #  TRAIN & COMPARE: availableCash (Regression)
    # ══════════════════════════════════════════════════════════════════
    print(f"\n{'-' * 65}")
    print(f"  TARGET: availableCash (Regression)")
    print(f"{'-' * 65}")

    cash_models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
        "XGBoost": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1,
                                random_state=42, verbosity=0),
    }
    cash_results = []
    cash_trained = {}
    for name, model in cash_models.items():
        model.fit(X_train_proc, y_cash_train)
        metrics = evaluate_regressor(name, model, X_test_proc, y_cash_test)
        cash_results.append(metrics)
        cash_trained[name] = model

    best_cash = max(cash_results, key=lambda x: x["r2"])
    print(f"\n  >> Best model: {best_cash['model_name']} (R2={best_cash['r2']})")

    # ══════════════════════════════════════════════════════════════════
    #  TRAIN & COMPARE: monthlyExpenses (Regression)
    # ══════════════════════════════════════════════════════════════════
    print(f"\n{'-' * 65}")
    print(f"  TARGET: monthlyExpenses (Regression)")
    print(f"{'-' * 65}")

    exp_models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42),
        "XGBoost": XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1,
                                random_state=42, verbosity=0),
    }
    exp_results = []
    exp_trained = {}
    for name, model in exp_models.items():
        model.fit(X_train_proc, y_exp_train)
        metrics = evaluate_regressor(name, model, X_test_proc, y_exp_test)
        exp_results.append(metrics)
        exp_trained[name] = model

    best_exp = max(exp_results, key=lambda x: x["r2"])
    print(f"\n  >> Best model: {best_exp['model_name']} (R2={best_exp['r2']})")

    # ══════════════════════════════════════════════════════════════════
    #  TRAIN & COMPARE: cashFlowStatus (Classification)
    # ══════════════════════════════════════════════════════════════════
    print(f"\n{'-' * 65}")
    print(f"  TARGET: cashFlowStatus (Classification)")
    print(f"{'-' * 65}")

    # Using class_weight='balanced' to handle the imbalanced 'critical' class
    cls_models = {
        "Logistic Regression": LogisticRegression(max_iter=1000, random_state=42,
                                                  class_weight="balanced"),
        "Random Forest": RandomForestClassifier(n_estimators=200, max_depth=12,
                                                random_state=42, class_weight="balanced"),
        "XGBoost": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1,
                                 random_state=42, verbosity=0, eval_metric="mlogloss"),
    }
    cls_results = []
    cls_trained = {}
    for name, model in cls_models.items():
        model.fit(X_train_proc, y_stat_train)
        metrics = evaluate_classifier(name, model, X_test_proc, y_stat_test, label_encoder)
        cls_results.append(metrics)
        cls_trained[name] = model

    best_cls = max(cls_results, key=lambda x: x["accuracy"])
    print(f"\n  >> Best model: {best_cls['model_name']} (Acc={best_cls['accuracy']})")

    # ══════════════════════════════════════════════════════════════════
    #  SAVE BEST MODELS
    # ══════════════════════════════════════════════════════════════════
    print(f"\n{'-' * 65}")
    print(f"  Saving models...")
    print(f"{'-' * 65}")

    os.makedirs(MODEL_DIR, exist_ok=True)

    # Save preprocessor
    joblib.dump(preprocessor, os.path.join(MODEL_DIR, "preprocessing_pipeline.joblib"))
    print(f"  Saved: preprocessing_pipeline.joblib")

    # Save label encoder
    joblib.dump(label_encoder, os.path.join(MODEL_DIR, "label_encoder.joblib"))
    print(f"  Saved: label_encoder.joblib")

    # Save best models
    best_cash_model = cash_trained[best_cash["model_name"]]
    joblib.dump(best_cash_model, os.path.join(MODEL_DIR, "cash_available_model.joblib"))
    print(f"  Saved: cash_available_model.joblib ({best_cash['model_name']})")

    best_exp_model = exp_trained[best_exp["model_name"]]
    joblib.dump(best_exp_model, os.path.join(MODEL_DIR, "monthly_expenses_model.joblib"))
    print(f"  Saved: monthly_expenses_model.joblib ({best_exp['model_name']})")

    best_cls_model = cls_trained[best_cls["model_name"]]
    joblib.dump(best_cls_model, os.path.join(MODEL_DIR, "cash_flow_classifier.joblib"))
    print(f"  Saved: cash_flow_classifier.joblib ({best_cls['model_name']})")

    # Save metadata
    metadata = {
        "trained_at": datetime.now().isoformat(),
        "dataset_size": len(df),
        "feature_columns": feature_cols,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "derived_features": DERIVED_FEATURES,
        "status_classes": status_classes,
        "best_models": {
            "availableCash": best_cash,
            "monthlyExpenses": best_exp,
            "cashFlowStatus": best_cls,
        }
    }
    with open(os.path.join(MODEL_DIR, "model_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  Saved: model_metadata.json")

    print(f"\n{'=' * 65}")
    print(f"  Training complete! All models saved to {MODEL_DIR}")
    print(f"{'=' * 65}")


if __name__ == "__main__":
    train_and_compare()
