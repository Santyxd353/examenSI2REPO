"""Detección de anomalías sin usar etiquetas de inyección como features."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .artifacts import save_trusted_artifact
from .dataset_schema import DATASET_ID, SOURCE
from .manifests import sha256_file, write_json

SERIES_COLUMNS = ("variant_id", "location_id", "channel")
LABEL_KEY_COLUMNS = ("date", *SERIES_COLUMNS)
CATEGORICAL_FEATURES = (*SERIES_COLUMNS, "category", "size", "color")
NUMERIC_FEATURES = ("units", "lag_1", "mean_past_7", "std_past_7")
FEATURE_COLUMNS = (*CATEGORICAL_FEATURES, *NUMERIC_FEATURES)
FORBIDDEN_FEATURES = {
    "injection_type",
    "original_units",
    "anomalous_units",
    "magnitude_units",
    "label",
    "is_anomaly",
    "anomaly_score",
}


def build_anomaly_features(panel: pd.DataFrame) -> pd.DataFrame:
    required = {"date", "units", *SERIES_COLUMNS, "category", "size", "color"}
    missing = required - set(panel.columns)
    if missing:
        raise ValueError(f"Faltan columnas para anomalías: {', '.join(sorted(missing))}")
    if FORBIDDEN_FEATURES & set(panel.columns):
        # Las columnas del panel alterado no contienen labels; si alguien intenta
        # adjuntarlas, se eliminan explícitamente antes de entrenar o puntuar.
        panel = panel.drop(columns=list(FORBIDDEN_FEATURES & set(panel.columns)))
    frame = panel.copy()
    frame["date"] = pd.to_datetime(frame["date"]).dt.normalize()
    frame["units"] = pd.to_numeric(frame["units"], errors="raise").astype(float)
    frame = frame.sort_values([*SERIES_COLUMNS, "date"]).reset_index(drop=True)
    grouped = frame.groupby(list(SERIES_COLUMNS), sort=False)["units"]
    frame["lag_1"] = grouped.shift(1)
    frame["mean_past_7"] = grouped.transform(lambda values: values.shift(1).rolling(7, min_periods=7).mean())
    frame["std_past_7"] = grouped.transform(lambda values: values.shift(1).rolling(7, min_periods=7).std(ddof=0))
    return frame.dropna(subset=list(NUMERIC_FEATURES)).reset_index(drop=True)


def create_anomaly_pipeline(*, n_estimators: int = 100, n_jobs: int = 1) -> Pipeline:
    transformer = ColumnTransformer(
        [
            ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=True), list(CATEGORICAL_FEATURES)),
            ("numeric", "passthrough", list(NUMERIC_FEATURES)),
        ],
        remainder="drop",
    )
    detector = IsolationForest(n_estimators=n_estimators, random_state=42, n_jobs=n_jobs, contamination="auto")
    return Pipeline([("preprocess", transformer), ("detector", detector)])


def fit_anomaly_model(featured: pd.DataFrame, *, n_estimators: int = 100, n_jobs: int = 1) -> Pipeline:
    if featured.empty:
        raise ValueError("MODEL_DATA_INSUFFICIENT: no hay historia para anomalías")
    model = create_anomaly_pipeline(n_estimators=n_estimators, n_jobs=n_jobs)
    model.fit(featured[list(FEATURE_COLUMNS)])
    return model


def anomaly_scores(model: Pipeline, featured: pd.DataFrame) -> np.ndarray:
    if featured.empty:
        return np.asarray([], dtype=float)
    # IsolationForest otorga mayores score_samples a puntos normales. Invertimos
    # para que un valor alto siempre signifique más anómalo.
    return -np.asarray(model.score_samples(featured[list(FEATURE_COLUMNS)]), dtype=float)


def labels_for_features(featured: pd.DataFrame, labels: pd.DataFrame) -> np.ndarray:
    if labels.empty:
        return np.zeros(len(featured), dtype=bool)
    required = set(LABEL_KEY_COLUMNS)
    if not required.issubset(labels.columns):
        raise ValueError("Las etiquetas no tienen la clave de anomalía esperada")
    label_keys = {
        tuple(row)
        for row in labels.assign(date=pd.to_datetime(labels["date"]).dt.normalize())[list(LABEL_KEY_COLUMNS)].itertuples(index=False, name=None)
    }
    return np.asarray(
        [tuple(row) in label_keys for row in featured[list(LABEL_KEY_COLUMNS)].itertuples(index=False, name=None)],
        dtype=bool,
    )


def classification_metrics(actual: Iterable[bool], predicted: Iterable[bool]) -> dict[str, Any]:
    actual_values = np.asarray(list(actual), dtype=bool)
    predicted_values = np.asarray(list(predicted), dtype=bool)
    if actual_values.shape != predicted_values.shape:
        raise ValueError("actual y predicted deben tener la misma forma")
    tp = int(np.sum(actual_values & predicted_values))
    fp = int(np.sum(~actual_values & predicted_values))
    tn = int(np.sum(~actual_values & ~predicted_values))
    fn = int(np.sum(actual_values & ~predicted_values))

    def ratio(numerator: int, denominator: int, reason: str) -> tuple[float | None, str | None]:
        return (None, reason) if denominator == 0 else (numerator / denominator, None)

    precision, precision_reason = ratio(tp, tp + fp, "SIN_ANOMALIAS_PREDICHAS")
    recall, recall_reason = ratio(tp, tp + fn, "SIN_ANOMALIAS_REALES")
    f1 = None if precision is None or recall is None or precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {
        "confusionMatrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "precision": precision,
        "precisionReason": precision_reason,
        "recall": recall,
        "recallReason": recall_reason,
        "f1": f1,
        "f1Reason": None if f1 is not None else "METRICA_NO_APLICA",
        "observations": int(actual_values.size),
    }


def calibrate_threshold(scores: Iterable[float], labels: Iterable[bool]) -> tuple[float, dict[str, Any]]:
    score_values = np.asarray(list(scores), dtype=float)
    label_values = np.asarray(list(labels), dtype=bool)
    if score_values.size == 0 or score_values.shape != label_values.shape:
        raise ValueError("Se requieren scores y etiquetas de validación")
    candidates = np.unique(score_values)
    # Un número alto es anómalo. El desempate conserva el umbral más estricto.
    evaluated = [(float(value), classification_metrics(label_values, score_values >= value)) for value in candidates]
    threshold, metrics = max(
        evaluated,
        key=lambda pair: ((pair[1]["f1"] if pair[1]["f1"] is not None else -1.0), pair[0]),
    )
    return threshold, metrics


def run_anomaly_training(
    panel_path: Path,
    labels_path: Path,
    output_dir: Path,
    *,
    scope: Mapping[str, Any],
    n_estimators: int = 100,
    n_jobs: int = 1,
) -> dict[str, Any]:
    panel = pd.read_csv(panel_path)
    labels = pd.read_csv(labels_path)
    featured = build_anomaly_features(panel)
    train = featured[featured["date"] <= pd.Timestamp("2026-06-12")]
    validation = featured[(featured["date"] >= pd.Timestamp("2026-06-13")) & (featured["date"] <= pd.Timestamp("2026-08-06"))]
    test = featured[featured["date"] >= pd.Timestamp("2026-08-07")]
    if train.empty or validation.empty or test.empty:
        raise ValueError("MODEL_DATA_INSUFFICIENT: se requiere división temporal train/validation/test")
    model = fit_anomaly_model(train, n_estimators=n_estimators, n_jobs=n_jobs)
    threshold, validation_metrics = calibrate_threshold(anomaly_scores(model, validation), labels_for_features(validation, labels))
    test_scores = anomaly_scores(model, test)
    test_metrics = classification_metrics(labels_for_features(test, labels), test_scores >= threshold)
    metadata = {
        "schemaVersion": "1.0",
        "datasetId": DATASET_ID,
        "source": SOURCE,
        "modelType": "IsolationForest",
        "modelVersion": "anomaly-iforest-seed42-v1",
        "panelSha256": sha256_file(panel_path),
        "labelsSha256": sha256_file(labels_path),
        "threshold": threshold,
        "scope": dict(scope),
        "limitations": [
            "Etiquetas sintéticas se usan solo para calibrar y medir; nunca como features.",
            "El detector no demuestra rendimiento sobre ventas reales.",
        ],
    }
    artifact = save_trusted_artifact(model, output_dir, "anomaly-model.joblib", metadata)
    result = {
        "schemaVersion": "1.0",
        "source": SOURCE,
        "datasetId": DATASET_ID,
        "modelId": scope.get("jobId"),
        "modelVersion": metadata["modelVersion"],
        "threshold": threshold,
        "validation": validation_metrics,
        "test": test_metrics,
        "artifact": artifact,
        "limitations": metadata["limitations"],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "anomaly-evaluation.json", result)
    write_json(output_dir / "anomaly-metadata.json", metadata | {"artifact": artifact})
    return result
