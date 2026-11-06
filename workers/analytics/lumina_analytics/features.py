"""Features temporales de demanda calculadas sin acceso al futuro."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

SERIES_COLUMNS = ("variant_id", "location_id", "channel")
CATEGORICAL_FEATURES = ("sku", "location_id", "channel", "category", "size", "color")
NUMERIC_FEATURES = (
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_28",
    "rolling_mean_past_7",
    "rolling_mean_past_28",
    "day_of_week",
    "month",
    "day_of_year",
    "trend_day",
)
FEATURE_COLUMNS = CATEGORICAL_FEATURES + NUMERIC_FEATURES
REQUIRED_COLUMNS = set(SERIES_COLUMNS) | {
    "date",
    "sku",
    "category",
    "size",
    "color",
    "units",
}


@dataclass(frozen=True)
class ForecastContext:
    panel: pd.DataFrame
    actual_matrix: pd.DataFrame
    metadata: pd.DataFrame
    first_day: pd.Timestamp


def normalize_panel(panel: pd.DataFrame) -> pd.DataFrame:
    missing = sorted(REQUIRED_COLUMNS - set(panel.columns))
    if missing:
        raise ValueError(f"Faltan columnas requeridas: {', '.join(missing)}")
    normalized = panel.copy()
    normalized["date"] = pd.to_datetime(normalized["date"], errors="raise").dt.normalize()
    normalized["units"] = pd.to_numeric(normalized["units"], errors="raise")
    if normalized["units"].isna().any() or (normalized["units"] < 0).any():
        raise ValueError("units debe contener cantidades no negativas")
    if normalized.duplicated(["date", *SERIES_COLUMNS]).any():
        raise ValueError("El panel contiene claves fecha/serie duplicadas")
    return normalized.sort_values([*SERIES_COLUMNS, "date"], kind="stable").reset_index(drop=True)


def build_features(panel: pd.DataFrame) -> pd.DataFrame:
    featured = normalize_panel(panel)
    grouped = featured.groupby(list(SERIES_COLUMNS), sort=False, observed=True)["units"]
    for lag in (1, 7, 14, 28):
        featured[f"lag_{lag}"] = grouped.shift(lag)
    featured["rolling_mean_past_7"] = grouped.transform(
        lambda values: values.shift(1).rolling(7, min_periods=7).mean()
    )
    featured["rolling_mean_past_28"] = grouped.transform(
        lambda values: values.shift(1).rolling(28, min_periods=28).mean()
    )
    featured["day_of_week"] = featured["date"].dt.dayofweek.astype("int16")
    featured["month"] = featured["date"].dt.month.astype("int16")
    featured["day_of_year"] = featured["date"].dt.dayofyear.astype("int16")
    first_day = featured["date"].min()
    featured["trend_day"] = (featured["date"] - first_day).dt.days.astype("int32")
    return featured


def valid_feature_rows(featured: pd.DataFrame) -> pd.DataFrame:
    return featured.dropna(subset=list(NUMERIC_FEATURES)).copy()


def build_forecast_context(panel: pd.DataFrame) -> ForecastContext:
    normalized = normalize_panel(panel)
    actual_matrix = normalized.pivot(
        index="date", columns=list(SERIES_COLUMNS), values="units"
    ).sort_index()
    if actual_matrix.isna().any().any():
        raise ValueError("El panel debe contener una cuadrícula diaria completa por serie")
    series_index = actual_matrix.columns
    metadata = (
        normalized.drop_duplicates(list(SERIES_COLUMNS), keep="first")
        .set_index(list(SERIES_COLUMNS))
        .reindex(series_index)
    )
    return ForecastContext(normalized, actual_matrix, metadata, normalized["date"].min())
