from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from lumina_analytics.anomalies import (
    anomaly_scores,
    build_anomaly_features,
    calibrate_threshold,
    classification_metrics,
    fit_anomaly_model,
    labels_for_features,
)
from lumina_analytics.dataset_schema import DatasetConfig, LOCATIONS, PRODUCTS, VARIANTS
from lumina_analytics.synthetic import iter_panel


def _panel() -> pd.DataFrame:
    config = DatasetConfig(
        date_from=date(2025, 10, 1),
        date_to=date(2025, 11, 20),
        products=(PRODUCTS[0],),
        variants=(VARIANTS[0],),
        locations=(LOCATIONS[0],),
        channels=("APP",),
    )
    return pd.DataFrame(iter_panel(config))


def test_anomaly_labels_do_not_change_features_or_scores() -> None:
    featured = build_anomaly_features(_panel())
    model = fit_anomaly_model(featured, n_estimators=10)
    scores_without_labels = anomaly_scores(model, featured)
    labels = pd.DataFrame(
        [{"date": featured.iloc[-1]["date"], "variant_id": "demo-variante-001", "location_id": "demo-ubicacion-01", "channel": "APP"}]
    )
    changed_labels = labels.copy()
    changed_labels["injection_type"] = "SPIKE"
    assert labels_for_features(featured, labels).sum() == labels_for_features(featured, changed_labels).sum()
    assert np.array_equal(scores_without_labels, anomaly_scores(model, featured))
    assert not {"injection_type", "magnitude_units", "label"} & set(featured.columns)


def test_threshold_is_calibrated_from_validation_and_metrics_keep_na() -> None:
    threshold, metrics = calibrate_threshold([0.1, 0.2, 0.8, 0.9], [False, False, True, True])
    assert threshold >= 0.8
    assert metrics["f1"] == 1.0
    no_positive = classification_metrics([False, False], [False, False])
    assert no_positive["recall"] is None
    assert no_positive["recallReason"] == "SIN_ANOMALIAS_REALES"
