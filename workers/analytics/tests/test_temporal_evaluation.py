from __future__ import annotations

import pandas as pd

from lumina_analytics.baseline import weekly_naive_forecast
from lumina_analytics.demand import recursive_forecast
from lumina_analytics.evaluation import calculate_metrics
from lumina_analytics.features import FEATURE_COLUMNS


class LagOneModel:
    def predict(self, frame: pd.DataFrame):
        assert list(frame.columns) == list(FEATURE_COLUMNS)
        return frame["lag_1"].to_numpy()


def _panel(days: int = 45) -> pd.DataFrame:
    units = list(range(1, days + 1))
    return pd.DataFrame(
        {
            "date": pd.date_range("2025-10-01", periods=days),
            "variant_id": ["demo-v1"] * days,
            "sku": ["DEMO-01-S"] * days,
            "location_id": ["demo-l1"] * days,
            "channel": ["APP"] * days,
            "category": ["VESTIDO"] * days,
            "size": ["S"] * days,
            "color": ["AZUL"] * days,
            "units": units,
        }
    )


def test_recursive_forecast_does_not_use_future_actual_units() -> None:
    panel = _panel()
    origin = pd.Timestamp("2025-11-04")
    first = recursive_forecast(LagOneModel(), panel, origin, 7)
    changed = panel.copy()
    changed.loc[changed["date"] > origin, "units"] = 9999
    second = recursive_forecast(LagOneModel(), changed, origin, 7)
    assert first["predicted_units"].tolist() == second["predicted_units"].tolist()
    assert first["predicted_units"].nunique() == 1
    assert first["predicted_units"].iloc[0] == 35


def test_weekly_baseline_is_recursive() -> None:
    panel = _panel()
    result = weekly_naive_forecast(panel, pd.Timestamp("2025-11-04"), 7)
    assert result["predicted_units"].tolist() == list(range(29, 36))


def test_wape_is_not_applicable_when_actual_sum_is_zero() -> None:
    metrics = calculate_metrics([0, 0], [0, 2])
    assert metrics.mae == 1
    assert metrics.wape is None
    assert metrics.wapeStatus == "NO_APLICA"
    assert metrics.wapeReason == "SUMA_REAL_CERO"


def test_metric_formulas_use_all_observations() -> None:
    metrics = calculate_metrics([1, 3], [2, 1])
    assert metrics.mae == 1.5
    assert round(metrics.rmse, 8) == round(2.5**0.5, 8)
    assert metrics.wape == 75
    assert metrics.observations == 2
