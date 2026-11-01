from __future__ import annotations

from copy import deepcopy
from datetime import date

from lumina_analytics.dataset_schema import DatasetConfig
from lumina_analytics.manifests import canonical_json_bytes, manifest_sha256
from lumina_analytics.synthetic import generate_bundle


def test_canonical_json_orders_keys_and_normalizes_unicode() -> None:
    first = {"z": "Lu\u0301mina", "a": [2, 1]}
    second = {"a": [2, 1], "z": "Lúmina"}
    assert canonical_json_bytes(first) == canonical_json_bytes(second)


def test_generated_at_is_excluded_from_reproducible_manifest_hash() -> None:
    manifest = {"datasetId": "demo", "generatedAt": "2026-01-01T00:00:00Z", "rowCount": 3}
    changed = deepcopy(manifest)
    changed["generatedAt"] = "2026-11-01T00:00:00Z"
    assert manifest_sha256(manifest) == manifest_sha256(changed)


def test_small_bundle_is_reproducible_and_files_are_separate(tmp_path) -> None:
    config = DatasetConfig(date_from=date(2025, 10, 1), date_to=date(2025, 10, 2))
    first = generate_bundle(tmp_path / "one", config)
    second = generate_bundle(tmp_path / "two", config)
    assert first["filesSha256"] == second["filesSha256"]
    assert first["manifestSha256"] == second["manifestSha256"]
    assert first["rowCount"] == config.expected_rows
    assert first["anomalyCopyRowCount"] == config.expected_rows
    assert (tmp_path / "one" / "panel.csv").read_bytes() == (tmp_path / "two" / "panel.csv").read_bytes()
    assert (tmp_path / "one" / "anomaly-labels.csv").exists()
    assert (tmp_path / "one" / "catalog.json").exists()
