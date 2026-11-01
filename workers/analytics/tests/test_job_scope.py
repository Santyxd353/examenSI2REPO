from __future__ import annotations

import json
from pathlib import Path

import pytest

from lumina_analytics.cli import _assert_artifact_scope
from lumina_analytics.job_schema import JobValidationError, parse_job


def _request(**changes: object) -> dict[str, object]:
    request: dict[str, object] = {
        "schemaVersion": "1.0",
        "jobId": "job-scope-001",
        "tenantId": "tenant-demo-001",
        "actorId": "actor-demo-001",
        "source": "DEMOSTRACION_SINTETICA",
        "action": "SUGGEST_RESTOCK",
        "datasetId": "demo-femenino-seed42-v1",
        "workDir": ".local/analytics/pytest-scope",
        "parameters": {},
        "inventorySnapshot": [],
    }
    request.update(changes)
    return request


def test_job_rejects_path_outside_private_workdir(tmp_path: Path) -> None:
    request_path = tmp_path / "job.json"
    request_path.write_text(json.dumps(_request(workDir=".local/../outside")), encoding="utf-8")
    with pytest.raises(JobValidationError, match="workDir"):
        parse_job(request_path, cwd=Path.cwd())


def test_artifact_scope_rejects_other_tenant_or_job() -> None:
    path = Path("scope.json")
    path.write_text(json.dumps(_request()), encoding="utf-8")
    try:
        job = parse_job(path, cwd=Path.cwd())
    finally:
        path.unlink()
    metadata = {
        "datasetId": "demo-femenino-seed42-v1",
        "scope": {"tenantId": "another-tenant", "jobId": "job-other", "source": "DEMOSTRACION_SINTETICA"},
    }
    with pytest.raises(JobValidationError, match="tenant"):
        _assert_artifact_scope(metadata, job)
    same_tenant_wrong_job = {
        "datasetId": "demo-femenino-seed42-v1",
        "scope": {"tenantId": "tenant-demo-001", "jobId": "job-other", "source": "DEMOSTRACION_SINTETICA"},
    }
    with pytest.raises(JobValidationError, match="artifactJobId"):
        _assert_artifact_scope(same_tenant_wrong_job, job)
    forecast_path = Path("scope-forecast.json")
    forecast_path.write_text(
        json.dumps(
            _request(
                action="FORECAST",
                horizonDays=7,
                parameters={"artifactJobId": "job-authorized"},
            )
        ),
        encoding="utf-8",
    )
    try:
        forecast_job = parse_job(forecast_path, cwd=Path.cwd())
    finally:
        forecast_path.unlink()
    with pytest.raises(JobValidationError, match="no corresponde"):
        _assert_artifact_scope(same_tenant_wrong_job, forecast_job)
