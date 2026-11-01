from __future__ import annotations

from pathlib import Path

import pytest

from lumina_analytics.artifacts import load_trusted_artifact, save_trusted_artifact


def test_artifact_roundtrip_requires_expected_hash(tmp_path: Path) -> None:
    artifact = save_trusted_artifact({"value": 7}, tmp_path, "model.joblib", {"version": "1"})
    loaded = load_trusted_artifact(
        tmp_path / "model.joblib", expected_sha256=artifact["sha256"], trusted_root=tmp_path
    )
    assert loaded == {"model": {"value": 7}, "metadata": {"version": "1"}}
    with pytest.raises(ValueError, match="hash"):
        load_trusted_artifact(
            tmp_path / "model.joblib", expected_sha256="0" * 64, trusted_root=tmp_path
        )


def test_artifact_outside_trusted_root_is_rejected(tmp_path: Path) -> None:
    trusted = tmp_path / "trusted"
    outside = tmp_path / "outside"
    trusted.mkdir()
    artifact = save_trusted_artifact({"value": 7}, outside, "model.joblib", {"version": "1"})
    with pytest.raises(ValueError, match="fuera"):
        load_trusted_artifact(
            outside / "model.joblib", expected_sha256=artifact["sha256"], trusted_root=trusted
        )
