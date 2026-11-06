"""Baseline semanal recursivo para comparar el modelo de demanda."""

from __future__ import annotations

import pandas as pd

from .features import ForecastContext, build_forecast_context


def weekly_naive_forecast(
    panel: pd.DataFrame,
    origin: pd.Timestamp,
    horizon_days: int,
    *,
    context: ForecastContext | None = None,
) -> pd.DataFrame:
    if horizon_days <= 0:
        raise ValueError("horizon_days debe ser positivo")
    context = context or build_forecast_context(panel)
    origin = pd.Timestamp(origin).normalize()
    matrix = context.actual_matrix.loc[:origin].copy()
    if len(matrix.index) < 7:
        raise ValueError("El baseline requiere al menos siete días de historia")
    future_dates = pd.date_range(origin + pd.Timedelta(days=1), periods=horizon_days, freq="D")
    if not future_dates.isin(context.actual_matrix.index).all():
        raise ValueError("La ventana solicitada está fuera de la cobertura del panel")
    series_index = matrix.columns
    predictions: list[pd.DataFrame] = []
    for day in future_dates:
        predicted = matrix.iloc[-7].to_numpy(dtype=float)
        actual = context.actual_matrix.loc[day].to_numpy(dtype=float)
        frame = series_index.to_frame(index=False)
        frame["date"] = day
        frame["actual_units"] = actual
        frame["predicted_units"] = predicted
        predictions.append(frame)
        matrix.loc[day] = predicted
    return pd.concat(predictions, ignore_index=True)
