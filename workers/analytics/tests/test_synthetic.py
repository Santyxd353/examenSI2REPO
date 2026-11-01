from __future__ import annotations

import json
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path

from lumina_analytics.dataset_schema import (
    DATASET_ID,
    LOCATIONS,
    PRODUCTS,
    SOURCE,
    VARIANTS,
    DatasetConfig,
    temporal_split,
)
from lumina_analytics.synthetic import inject_anomaly, iter_panel, row_key


FIXTURE = Path(__file__).parent / "fixtures" / "demo-contract.json"


def test_full_grid_matches_documented_contract() -> None:
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    config = DatasetConfig()
    assert config.days == expected["days"]
    assert len(PRODUCTS) == expected["products"]
    assert len(VARIANTS) == expected["variants"]
    assert len(LOCATIONS) == expected["locations"]
    assert config.expected_rows == expected["rows"]
    assert sum(1 for _ in iter_panel(config)) == expected["rows"]


def test_rows_are_deterministic_unique_nonnegative_and_include_zero() -> None:
    config = DatasetConfig(date_from=date(2025, 10, 1), date_to=date(2025, 10, 3))
    first = list(iter_panel(config))
    second = list(iter_panel(config))
    assert first == second
    keys = {row_key(row) for row in first}
    assert len(keys) == len(first) == config.expected_rows
    assert all(isinstance(row["units"], int) and row["units"] >= 0 for row in first)
    assert any(row["units"] == 0 for row in first)
    assert all(row["revenue_cents"] == row["units"] * row["unit_price_cents"] for row in first)
    assert {row["dataset_id"] for row in first} == {DATASET_ID}
    assert {row["source"] for row in first} == {SOURCE}


def test_catalog_is_female_demo_namespace_with_three_variants_each() -> None:
    assert all(product.category in {"VESTIDO", "FALDA"} for product in PRODUCTS)
    assert all(product.product_id.startswith("demo-producto-") for product in PRODUCTS)
    assert all(variant.variant_id.startswith("demo-variante-") for variant in VARIANTS)
    for product in PRODUCTS:
        assert sum(variant.product_id == product.product_id for variant in VARIANTS) == 3


def test_temporal_split_has_exact_boundaries() -> None:
    assert temporal_split(date(2025, 10, 1)) == "TRAIN"
    assert temporal_split(date(2026, 6, 12)) == "TRAIN"
    assert temporal_split(date(2026, 6, 13)) == "VALIDATION"
    assert temporal_split(date(2026, 8, 6)) == "VALIDATION"
    assert temporal_split(date(2026, 8, 7)) == "TEST"
    assert temporal_split(date(2026, 9, 30)) == "TEST"
    counts = {"TRAIN": 0, "VALIDATION": 0, "TEST": 0}
    day = date(2025, 10, 1)
    while day <= date(2026, 9, 30):
        counts[temporal_split(day)] += 1
        day += timedelta(days=1)
    assert counts == {"TRAIN": 255, "VALIDATION": 55, "TEST": 55}


def test_anomaly_copy_does_not_mutate_base_or_leak_labels() -> None:
    base_rows = list(iter_panel(DatasetConfig(date_from=date(2025, 10, 1), date_to=date(2025, 10, 5))))
    before = deepcopy(base_rows)
    labels = []
    anomaly_rows = []
    for base in base_rows:
        anomaly, label = inject_anomaly(base)
        anomaly_rows.append(anomaly)
        if label:
            labels.append(label)
    assert base_rows == before
    assert labels
    assert all("injection_type" not in row and "magnitude_units" not in row for row in anomaly_rows)
    assert all(label["row_key"] in {row_key(row) for row in base_rows} for label in labels)
