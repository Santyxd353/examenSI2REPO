"""Ejecutable seguro del worker analítico: un JSON final por stdout."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from .anomalies import run_anomaly_training
from .artifacts import load_trusted_artifact
from .dataset_schema import DATASET_ID, SOURCE
from .demand import recursive_forecast, run_training
from .job_schema import AnalyticsJob, JobValidationError, parse_job, resolve_inside
from .restock import restock_suggestion
from .result_schema import write_result
from .synthetic import generate_bundle


def _log(event: str, **fields: Any) -> None:
    print(json.dumps({"event": event, **fields}, ensure_ascii=False, sort_keys=True), file=sys.stderr, flush=True)


def _parameter_path(job: AnalyticsJob, key: str, *, required: bool = True) -> Path | None:
    value = job.parameters.get(key)
    if value is None and not required:
        return None
    return resolve_inside(value, job.work_dir, field=f"parameters.{key}", must_exist=True)


def _scope(job: AnalyticsJob) -> dict[str, str]:
    return {"tenantId": job.tenant_id, "jobId": job.job_id, "source": job.source, "datasetId": job.dataset_id or DATASET_ID}


def _assert_artifact_scope(metadata: Any, job: AnalyticsJob) -> None:
    if not isinstance(metadata, dict):
        raise JobValidationError("INVALID_ARTIFACT", "El artefacto no tiene metadatos válidos")
    scope = metadata.get("scope")
    if not isinstance(scope, dict) or scope.get("tenantId") != job.tenant_id or scope.get("source") != job.source:
        raise JobValidationError("INVALID_ARTIFACT", "El artefacto no pertenece al tenant o fuente del job")
    if metadata.get("datasetId") != (job.dataset_id or DATASET_ID):
        raise JobValidationError("INVALID_ARTIFACT", "El artefacto no pertenece al dataset solicitado")
    expected_job = job.parameters.get("artifactJobId")
    if not isinstance(expected_job, str):
        raise JobValidationError("INVALID_ARTIFACT", "FORECAST requiere el artifactJobId autorizado")
    if scope.get("jobId") != expected_job:
        raise JobValidationError("INVALID_ARTIFACT", "El artefacto no corresponde al job autorizado")


def execute(job: AnalyticsJob) -> dict[str, str]:
    job.work_dir.mkdir(parents=True, exist_ok=True)
    _log("job_started", action=job.action, jobId=job.job_id)
    if job.action == "GENERATE_DATASET":
        output = job.work_dir / "datasets" / job.job_id
        manifest = generate_bundle(output)
        return write_result(job, {"coverage": manifest["dateRange"], "manifest": manifest, "limitations": manifest["limitations"]})

    if job.action == "TRAIN_DEMAND":
        panel = _parameter_path(job, "panelPath")
        output = job.work_dir / "models" / job.job_id
        evaluation = run_training(
            panel, output, n_estimators=int(job.parameters.get("nEstimators", 200)), n_jobs=1,
            scope=_scope(job),
        )
        return write_result(job, {"modelId": job.job_id, "modelVersion": "demand-rf-seed42-v1", "metrics": evaluation, "limitations": evaluation.get("limitations", [])})

    if job.action == "TRAIN_ANOMALY":
        panel = _parameter_path(job, "panelPath")
        labels = _parameter_path(job, "labelsPath")
        output = job.work_dir / "models" / job.job_id
        evaluation = run_anomaly_training(panel, labels, output, scope=_scope(job), n_jobs=1)
        return write_result(job, {"modelId": job.job_id, "modelVersion": evaluation["modelVersion"], "metrics": evaluation, "limitations": evaluation["limitations"]})

    if job.action == "FORECAST":
        artifact_path = _parameter_path(job, "artifactPath")
        expected_hash = job.parameters.get("artifactSha256")
        if not isinstance(expected_hash, str) or len(expected_hash) != 64:
            raise JobValidationError("INVALID_ARTIFACT", "artifactSha256 es obligatorio")
        loaded = load_trusted_artifact(artifact_path, expected_sha256=expected_hash, trusted_root=job.work_dir)
        _assert_artifact_scope(loaded["metadata"], job)
        panel = _parameter_path(job, "panelPath")
        origin = job.parameters.get("origin")
        if not isinstance(origin, str):
            raise JobValidationError("INVALID_JOB", "FORECAST requiere parameters.origin")
        frame = pd.read_csv(panel)
        frame["date"] = pd.to_datetime(frame["date"]).dt.normalize()
        forecast = recursive_forecast(loaded["model"], frame, pd.Timestamp(origin), job.horizon_days or 0)
        forecast["date"] = forecast["date"].dt.date.astype(str)
        return write_result(job, {"modelVersion": loaded["metadata"].get("modelVersion"), "coverage": {"from": str(forecast["date"].min()), "to": str(forecast["date"].max())}, "rows": forecast.to_dict(orient="records"), "limitations": loaded["metadata"].get("limitations", [])})

    if job.action == "SUGGEST_RESTOCK":
        suggestions = [restock_suggestion(item) for item in job.inventory_snapshot]
        return write_result(job, {"suggestions": suggestions, "limitations": ["Las sugerencias no escriben stock ni crean compras."]})
    raise JobValidationError("INVALID_ACTION", "action no está permitida")


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    job_id: str | None = None
    try:
        if len(arguments) != 2 or arguments[0] != "--job":
            raise JobValidationError("INVALID_ARGUMENTS", "Uso: python -m lumina_analytics.cli --job request.json")
        try:
            request_preview = json.loads(Path(arguments[1]).read_text(encoding="utf-8"))
            if isinstance(request_preview, dict) and isinstance(request_preview.get("jobId"), str):
                job_id = request_preview["jobId"]
        except (OSError, json.JSONDecodeError):
            pass
        job = parse_job(Path(arguments[1]), cwd=Path.cwd())
        job_id = job.job_id
        response = {"ok": True, "jobId": job.job_id, **execute(job)}
        print(json.dumps(response, ensure_ascii=False, sort_keys=True))
        return 0
    except JobValidationError as error:
        print(json.dumps({"ok": False, "jobId": job_id, "error": {"code": error.code, "message": str(error)}}, ensure_ascii=False, sort_keys=True))
        return 2
    except (ValueError, OSError, KeyError) as error:
        _log("job_failed", errorType=type(error).__name__)
        print(json.dumps({"ok": False, "jobId": job_id, "error": {"code": "ANALYTICS_FAILED", "message": "El job analítico no pudo completarse."}}, ensure_ascii=False, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
