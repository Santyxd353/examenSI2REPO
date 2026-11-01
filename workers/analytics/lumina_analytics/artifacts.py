"""Persistencia verificable de artefactos de confianza del pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import joblib

from .manifests import sha256_file


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def save_trusted_artifact(
    model: Any, output_dir: Path, filename: str, metadata: Mapping[str, Any]
) -> dict[str, Any]:
    if Path(filename).name != filename or not filename.endswith(".joblib"):
        raise ValueError("El artefacto debe ser un nombre .joblib sin directorios")
    output_dir.mkdir(parents=True, exist_ok=True)
    path = (output_dir / filename).resolve()
    if not _inside(path, output_dir.resolve()):
        raise ValueError("La ruta del artefacto sale del directorio autorizado")
    joblib.dump({"model": model, "metadata": dict(metadata)}, path, compress=3)
    return {"filename": filename, "sha256": sha256_file(path), "bytes": path.stat().st_size}


def load_trusted_artifact(path: Path, *, expected_sha256: str, trusted_root: Path) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    root = trusted_root.resolve(strict=True)
    if not _inside(resolved, root):
        raise ValueError("El artefacto está fuera del directorio autorizado")
    if resolved.suffix != ".joblib":
        raise ValueError("El artefacto debe usar extensión .joblib")
    if sha256_file(resolved) != expected_sha256:
        raise ValueError("El hash del artefacto no coincide")
    loaded = joblib.load(resolved)
    if not isinstance(loaded, dict) or set(loaded) != {"model", "metadata"}:
        raise ValueError("El artefacto no tiene el sobre esperado")
    return loaded
