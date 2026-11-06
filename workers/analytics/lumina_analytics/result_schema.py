"""Salida persistida del worker y respuesta mínima del protocolo."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .job_schema import AnalyticsJob, inside
from .manifests import sha256_file, write_json


def write_result(job: AnalyticsJob, payload: Mapping[str, Any]) -> dict[str, str]:
    results_dir = (job.work_dir / "results").resolve()
    if not inside(results_dir, job.work_dir.resolve()):
        raise ValueError("La salida sale del workDir")
    results_dir.mkdir(parents=True, exist_ok=True)
    path = results_dir / f"{job.job_id}.json"
    document = {
        "schemaVersion": job.schema_version,
        "jobId": job.job_id,
        "tenantId": job.tenant_id,
        "actorId": job.actor_id,
        "action": job.action,
        "source": job.source,
        "datasetId": job.dataset_id,
        "modelId": job.model_id,
        "horizonDays": job.horizon_days,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        **dict(payload),
    }
    write_json(path, document)
    return {"resultPath": path.relative_to(job.work_dir).as_posix(), "sha256": sha256_file(path)}
