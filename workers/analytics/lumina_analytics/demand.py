"""Entrenamiento y pronóstico recursivo de demanda."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .artifacts import save_trusted_artifact
from .dataset_schema import DATASET_ID, SOURCE
from .evaluation import evaluate_origins
from .features import (
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    ForecastContext,
    NUMERIC_FEATURES,
    SERIES_COLUMNS,
    build_forecast_context,
    build_features,
    valid_feature_rows,
)
from .manifests import sha256_file, write_json


def create_demand_pipeline(
    *, max_depth: int = 12, n_estimators: int = 200, min_samples_leaf: int = 2, n_jobs: int = 1
) -> Pipeline:
    transformer = ColumnTransformer(
        [
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=True),
                list(CATEGORICAL_FEATURES),
            ),
            ("numeric", "passthrough", list(NUMERIC_FEATURES)),
        ],
        remainder="drop",
    )
    regressor = RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_leaf=min_samples_leaf,
        random_state=42,
        n_jobs=n_jobs,
    )
    return Pipeline([("preprocess", transformer), ("regressor", regressor)])


def fit_demand_model(
    featured: pd.DataFrame,
    *,
    max_depth: int = 12,
    n_estimators: int = 200,
    min_samples_leaf: int = 2,
    n_jobs: int = 1,
) -> Pipeline:
    valid = valid_feature_rows(featured)
    if valid.empty:
        raise ValueError("No hay filas con 28 días de historia para entrenar")
    model = create_demand_pipeline(
        max_depth=max_depth,
        n_estimators=n_estimators,
        min_samples_leaf=min_samples_leaf,
        n_jobs=n_jobs,
    )
    model.fit(valid[list(FEATURE_COLUMNS)], valid["units"].astype(float))
    return model


def recursive_forecast(
    model: Pipeline,
    panel: pd.DataFrame,
    origin: pd.Timestamp,
    horizon_days: int,
    *,
    context: ForecastContext | None = None,
) -> pd.DataFrame:
    if horizon_days not in {7, 30}:
        raise ValueError("El horizonte permitido es 7 o 30 días")
    context = context or build_forecast_context(panel)
    origin = pd.Timestamp(origin).normalize()
    matrix = context.actual_matrix.loc[:origin].copy()
    if len(matrix.index) < 28:
        raise ValueError("MODEL_DATA_INSUFFICIENT: se requieren 28 días de historia")
    future_dates = pd.date_range(origin + pd.Timedelta(days=1), periods=horizon_days, freq="D")
    if not future_dates.isin(context.actual_matrix.index).all():
        raise ValueError("La ventana solicitada está fuera de la cobertura del panel")

    series_index = matrix.columns
    predictions: list[pd.DataFrame] = []
    for day in future_dates:
        feature_frame = context.metadata.reset_index()[
            [*SERIES_COLUMNS, "sku", "category", "size", "color"]
        ].copy()
        for lag in (1, 7, 14, 28):
            feature_frame[f"lag_{lag}"] = matrix.iloc[-lag].to_numpy(dtype=float)
        feature_frame["rolling_mean_past_7"] = matrix.iloc[-7:].mean(axis=0).to_numpy()
        feature_frame["rolling_mean_past_28"] = matrix.iloc[-28:].mean(axis=0).to_numpy()
        feature_frame["day_of_week"] = day.dayofweek
        feature_frame["month"] = day.month
        feature_frame["day_of_year"] = day.dayofyear
        feature_frame["trend_day"] = (day - context.first_day).days
        predicted = np.clip(model.predict(feature_frame[list(FEATURE_COLUMNS)]), 0.0, None)

        result = series_index.to_frame(index=False)
        result["date"] = day
        result["actual_units"] = context.actual_matrix.loc[day].to_numpy(dtype=float)
        result["predicted_units"] = predicted
        predictions.append(result)
        matrix.loc[day] = predicted
    return pd.concat(predictions, ignore_index=True)


def _weighted_mae(results: Iterable[dict[str, Any]]) -> float:
    results = list(results)
    observations = sum(item["model"]["observations"] for item in results)
    return sum(item["model"]["mae"] * item["model"]["observations"] for item in results) / observations


def run_training(
    panel_path: Path,
    output_dir: Path,
    *,
    n_estimators: int = 200,
    n_jobs: int = 1,
) -> dict[str, Any]:
    started = time.perf_counter()
    panel = pd.read_csv(panel_path)
    panel["date"] = pd.to_datetime(panel["date"]).dt.normalize()
    featured = build_features(panel)
    train_end = pd.Timestamp("2026-06-12")
    validation_end = pd.Timestamp("2026-08-06")
    train_features = featured[featured["date"] <= train_end]

    validation_origins = {
        7: pd.date_range("2026-06-12", "2026-07-30", freq="D"),
        30: pd.date_range("2026-06-12", "2026-07-07", freq="D"),
    }
    candidates: list[dict[str, Any]] = []
    for max_depth in (8, 12):
        fit_started = time.perf_counter()
        model = fit_demand_model(
            train_features,
            max_depth=max_depth,
            n_estimators=n_estimators,
            n_jobs=n_jobs,
        )
        horizon_results = [
            evaluate_origins(model, panel, origins, horizon)
            for horizon, origins in validation_origins.items()
        ]
        candidates.append(
            {
                "maxDepth": max_depth,
                "nEstimators": n_estimators,
                "selectionMetric": "MAE",
                "weightedMae": _weighted_mae(horizon_results),
                "horizons": horizon_results,
                "durationSeconds": round(time.perf_counter() - fit_started, 3),
            }
        )
    selected = min(candidates, key=lambda item: item["weightedMae"])

    final_features = featured[featured["date"] <= validation_end]
    final_model = fit_demand_model(
        final_features,
        max_depth=selected["maxDepth"],
        n_estimators=n_estimators,
        n_jobs=n_jobs,
    )
    test_origins = {
        7: pd.date_range("2026-08-06", "2026-09-23", freq="D"),
        30: pd.date_range("2026-08-06", "2026-08-31", freq="D"),
    }
    test_results = [
        evaluate_origins(final_model, panel, origins, horizon)
        for horizon, origins in test_origins.items()
    ]

    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = {
        "schemaVersion": "1.0",
        "datasetId": DATASET_ID,
        "source": SOURCE,
        "modelType": "RandomForestRegressor",
        "modelVersion": "demand-rf-seed42-v1",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "panelSha256": sha256_file(panel_path),
        "selectedParameters": {
            "nEstimators": n_estimators,
            "maxDepth": selected["maxDepth"],
            "minSamplesLeaf": 2,
            "randomState": 42,
            "nJobs": n_jobs,
        },
        "featureColumns": list(FEATURE_COLUMNS),
        "trainingCoverage": {"from": "2025-10-01", "to": "2026-08-06"},
        "limitations": [
            "Modelo entrenado únicamente con datos sintéticos de demostración.",
            "Las métricas no representan precisión sobre ventas reales.",
            "Series con menos de 28 días de historia devuelven MODEL_DATA_INSUFFICIENT.",
        ],
    }
    artifact = save_trusted_artifact(final_model, output_dir, "demand-model.joblib", metadata)
    evaluation = {
        "schemaVersion": "1.0",
        "datasetId": DATASET_ID,
        "source": SOURCE,
        "selection": {"candidates": candidates, "selectedMaxDepth": selected["maxDepth"]},
        "test": test_results,
        "artifact": artifact,
        "totalDurationSeconds": round(time.perf_counter() - started, 3),
    }
    write_json(output_dir / "evaluation.json", evaluation)
    write_json(output_dir / "metadata.json", metadata | {"artifact": artifact})
    return evaluation


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Entrena y evalúa demanda sintética de Lúmina")
    parser.add_argument("--panel", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--estimators", type=int, default=200)
    parser.add_argument("--jobs", type=int, default=1)
    args = parser.parse_args(argv)
    result = run_training(args.panel, args.output, n_estimators=args.estimators, n_jobs=args.jobs)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
