"""Métricas y evaluación walk-forward de demanda."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, TYPE_CHECKING

import numpy as np
import pandas as pd

from .baseline import weekly_naive_forecast
from .features import build_forecast_context

if TYPE_CHECKING:
    from sklearn.pipeline import Pipeline


@dataclass(frozen=True)
class DemandMetrics:
    mae: float
    rmse: float
    wape: float | None
    wapeStatus: str
    wapeReason: str | None
    observations: int

    def to_dict(self) -> dict[str, float | int | str | None]:
        return asdict(self)


def calculate_metrics(actual: Iterable[float], predicted: Iterable[float]) -> DemandMetrics:
    actual_array = np.asarray(list(actual), dtype=float)
    predicted_array = np.asarray(list(predicted), dtype=float)
    if actual_array.size == 0 or actual_array.shape != predicted_array.shape:
        raise ValueError("actual y predicted deben tener la misma cantidad positiva de observaciones")
    errors = actual_array - predicted_array
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(np.square(errors))))
    denominator = float(np.sum(np.abs(actual_array)))
    if denominator == 0:
        return DemandMetrics(mae, rmse, None, "NO_APLICA", "SUMA_REAL_CERO", int(actual_array.size))
    wape = float(100.0 * np.sum(np.abs(errors)) / denominator)
    return DemandMetrics(mae, rmse, wape, "EVALUABLE", None, int(actual_array.size))


def evaluate_origins(
    model: "Pipeline", panel: pd.DataFrame, origins: Iterable[pd.Timestamp], horizon_days: int
) -> dict[str, object]:
    from .demand import recursive_forecast

    model_frames: list[pd.DataFrame] = []
    baseline_frames: list[pd.DataFrame] = []
    normalized_origins = [pd.Timestamp(origin).normalize() for origin in origins]
    context = build_forecast_context(panel)
    for origin in normalized_origins:
        model_frames.append(
            recursive_forecast(model, panel, origin, horizon_days, context=context)
        )
        baseline_frames.append(
            weekly_naive_forecast(panel, origin, horizon_days, context=context)
        )
    model_result = pd.concat(model_frames, ignore_index=True)
    baseline_result = pd.concat(baseline_frames, ignore_index=True)
    return {
        "horizonDays": horizon_days,
        "origins": len(normalized_origins),
        "originFrom": normalized_origins[0].date().isoformat(),
        "originTo": normalized_origins[-1].date().isoformat(),
        "model": calculate_metrics(
            model_result["actual_units"], model_result["predicted_units"]
        ).to_dict(),
        "baseline": calculate_metrics(
            baseline_result["actual_units"], baseline_result["predicted_units"]
        ).to_dict(),
    }
