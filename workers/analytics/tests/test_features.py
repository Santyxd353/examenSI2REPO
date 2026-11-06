from __future__ import annotations

import pandas as pd

from lumina_analytics.features import build_features


def _panel(units: list[int]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "date": pd.date_range("2025-10-01", periods=len(units)),
            "variant_id": ["demo-v1"] * len(units),
            "sku": ["DEMO-01-S"] * len(units),
            "location_id": ["demo-l1"] * len(units),
            "channel": ["APP"] * len(units),
            "category": ["VESTIDO"] * len(units),
            "size": ["S"] * len(units),
            "color": ["AZUL"] * len(units),
            "units": units,
        }
    )


def test_lags_and_rolling_use_only_past_values() -> None:
    features = build_features(_panel(list(range(1, 41)))).set_index("date")
    day = pd.Timestamp("2025-10-29")
    assert features.loc[day, "lag_1"] == 28
    assert features.loc[day, "lag_7"] == 22
    assert features.loc[day, "lag_28"] == 1
    assert features.loc[day, "rolling_mean_past_7"] == 25
    assert features.loc[day, "rolling_mean_past_28"] == 14.5


def test_changing_future_targets_does_not_change_previous_features() -> None:
    original = _panel(list(range(1, 41)))
    changed = original.copy()
    changed.loc[changed["date"] > "2025-10-29", "units"] = 9999
    before = build_features(original).set_index("date").loc["2025-10-29"]
    after = build_features(changed).set_index("date").loc["2025-10-29"]
    columns = ["lag_1", "lag_7", "lag_14", "lag_28", "rolling_mean_past_7", "rolling_mean_past_28"]
    assert before[columns].to_dict() == after[columns].to_dict()
