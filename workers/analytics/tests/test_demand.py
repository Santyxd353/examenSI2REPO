from __future__ import annotations

from datetime import date

import pandas as pd

from lumina_analytics.dataset_schema import DatasetConfig, LOCATIONS, PRODUCTS, VARIANTS
from lumina_analytics.demand import fit_demand_model, recursive_forecast
from lumina_analytics.features import build_features
from lumina_analytics.synthetic import iter_panel


def _small_panel() -> pd.DataFrame:
    config = DatasetConfig(
        date_from=date(2025, 10, 1),
        date_to=date(2025, 11, 15),
        products=(PRODUCTS[0],),
        variants=(VARIANTS[0],),
        locations=(LOCATIONS[0],),
        channels=("APP",),
    )
    return pd.DataFrame(iter_panel(config))


def test_model_trains_and_forecasts_nonnegative_values() -> None:
    panel = _small_panel()
    model = fit_demand_model(build_features(panel.iloc[:38]), n_estimators=5, max_depth=4)
    forecast = recursive_forecast(model, panel, pd.Timestamp("2025-11-08"), 7)
    assert len(forecast) == 7
    assert (forecast["predicted_units"] >= 0).all()


def test_unknown_category_is_accepted_by_pipeline() -> None:
    panel = _small_panel()
    featured = build_features(panel.iloc[:38])
    model = fit_demand_model(featured, n_estimators=5, max_depth=4)
    sample = featured.dropna().iloc[[-1]].copy()
    sample["channel"] = "CANAL_NUEVO"
    assert model.predict(sample).shape == (1,)
