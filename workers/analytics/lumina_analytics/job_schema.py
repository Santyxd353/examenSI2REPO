"""Validación estricta del contrato AnalyticsJobV1, sin dependencias HTTP/DB."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .dataset_schema import DATASET_ID, SOURCE

SCHEMA_VERSION = "1.0"
ACTIONS = {"GENERATE_DATASET", "TRAIN_DEMAND", "TRAIN_ANOMALY", "FORECAST", "SUGGEST_RESTOCK"}
SOURCES = {SOURCE, "REAL"}
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")


class JobValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AnalyticsJob:
    schema_version: str
    job_id: str
    tenant_id: str
    actor_id: str
    source: str
    action: str
    dataset_id: str | None
    model_id: str | None
    horizon_days: int | None
    work_dir: Path
    parameters: Mapping[str, Any]
    inventory_snapshot: tuple[Mapping[str, Any], ...]


def _validate_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise JobValidationError("INVALID_JOB", f"{field} no tiene un formato permitido")
    return value


def repository_root(start: Path) -> Path:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate / ".git").exists():
            return candidate
    raise JobValidationError("INVALID_PATH", "No se encontró la raíz autorizada del repositorio")


def inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_inside(path_value: Any, root: Path, *, field: str, must_exist: bool = False) -> Path:
    if not isinstance(path_value, str) or not path_value or Path(path_value).is_absolute():
        raise JobValidationError("INVALID_PATH", f"{field} debe ser una ruta relativa")
    resolved = (root / path_value).resolve()
    if not inside(resolved, root.resolve()):
        raise JobValidationError("INVALID_PATH", f"{field} sale del directorio autorizado")
    if must_exist and not resolved.exists():
        raise JobValidationError("INVALID_PATH", f"{field} no existe")
    return resolved


def parse_job(path: Path, *, cwd: Path | None = None) -> AnalyticsJob:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JobValidationError("INVALID_JOB", "No se pudo leer una solicitud JSON válida") from error
    if not isinstance(raw, dict):
        raise JobValidationError("INVALID_JOB", "La solicitud debe ser un objeto JSON")
    allowed = {"schemaVersion", "jobId", "tenantId", "actorId", "source", "action", "datasetId", "modelId", "horizonDays", "workDir", "parameters", "inventorySnapshot"}
    unknown = set(raw) - allowed
    if unknown:
        raise JobValidationError("INVALID_JOB", f"Campos no permitidos: {', '.join(sorted(unknown))}")
    if raw.get("schemaVersion") != SCHEMA_VERSION:
        raise JobValidationError("INVALID_JOB", "schemaVersion no compatible")
    action = raw.get("action")
    if action not in ACTIONS:
        raise JobValidationError("INVALID_ACTION", "action no está permitida")
    source = raw.get("source")
    if source not in SOURCES:
        raise JobValidationError("INVALID_JOB", "source no está permitido")
    horizon = raw.get("horizonDays")
    if horizon is not None and horizon not in {7, 30}:
        raise JobValidationError("INVALID_HORIZON", "horizonDays debe ser 7 o 30")
    if action == "FORECAST" and horizon is None:
        raise JobValidationError("INVALID_HORIZON", "FORECAST requiere horizonDays 7 o 30")
    if action in {"GENERATE_DATASET", "TRAIN_DEMAND", "TRAIN_ANOMALY"} and source != SOURCE:
        raise JobValidationError("MODEL_DATA_INSUFFICIENT", "No existe pipeline sintético sustitutivo para datos reales")
    dataset_id = raw.get("datasetId")
    if dataset_id is not None and dataset_id != DATASET_ID:
        raise JobValidationError("INVALID_JOB", "datasetId no está autorizado")
    if source == SOURCE and dataset_id not in {None, DATASET_ID}:
        raise JobValidationError("INVALID_JOB", "El dataset sintético no coincide")

    parameters = raw.get("parameters", {})
    snapshot = raw.get("inventorySnapshot", [])
    if not isinstance(parameters, dict) or not isinstance(snapshot, list) or not all(isinstance(item, dict) for item in snapshot):
        raise JobValidationError("INVALID_JOB", "parameters e inventorySnapshot tienen forma inválida")
    active_cwd = (cwd or Path.cwd()).resolve()
    root = repository_root(active_cwd)
    local_root = (root / ".local").resolve()
    local_root.mkdir(parents=True, exist_ok=True)
    work_dir = resolve_inside(raw.get("workDir"), root, field="workDir")
    if not inside(work_dir, local_root):
        raise JobValidationError("INVALID_PATH", "workDir debe estar dentro de .local")
    return AnalyticsJob(
        schema_version=SCHEMA_VERSION,
        job_id=_validate_id(raw.get("jobId"), "jobId"),
        tenant_id=_validate_id(raw.get("tenantId"), "tenantId"),
        actor_id=_validate_id(raw.get("actorId"), "actorId"),
        source=source,
        action=action,
        dataset_id=dataset_id,
        model_id=raw.get("modelId") if raw.get("modelId") is None else _validate_id(raw.get("modelId"), "modelId"),
        horizon_days=horizon,
        work_dir=work_dir,
        parameters=parameters,
        inventory_snapshot=tuple(snapshot),
    )
